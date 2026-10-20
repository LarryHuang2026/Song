from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import ffmpeg
from .peaks import compute_peaks
from .analysis import melody_analysis, prepare_samples
from .editing import decode_stereo, replace_segment, write_wav_immutable, RATE

DATA_ROOT = Path(
    os.environ.get("AUDIO_DATA_ROOT", Path(__file__).resolve().parents[2] / "data")
).resolve()

PEAKS_SAMPLE_RATE = 8000

app = FastAPI(title="AI Music Studio Audio Service", version="0.1.0")


def resolve_in_data_root(relative: str) -> Path:
    candidate = (DATA_ROOT / relative).resolve()
    if candidate != DATA_ROOT and DATA_ROOT not in candidate.parents:
        raise HTTPException(status_code=400, detail="path escapes data root")
    return candidate


def existing_file(relative: str) -> Path:
    path = resolve_in_data_root(relative)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    return path


class PathRequest(BaseModel):
    path: str = Field(min_length=1, description="Path relative to the data root")


class ConvertRequest(BaseModel):
    src: str = Field(min_length=1)
    dst: str = Field(min_length=1)
    sample_rate: int = Field(default=44100, ge=8000, le=192000)
    channels: int = Field(default=2, ge=1, le=2)


class PeaksRequest(PathRequest):
    points: int = Field(default=1000, ge=10, le=20000)


class PrepareRequest(BaseModel):
    src: str = Field(min_length=1)
    dst: str = Field(min_length=1)
    trim_silence: bool = True
    normalize: bool = True


class ReplaceRequest(BaseModel):
    base: str = Field(min_length=1)
    replacement: str = Field(min_length=1)
    dst: str = Field(min_length=1)
    start_sec: float = Field(ge=0, allow_inf_nan=False)
    end_sec: float = Field(gt=0, allow_inf_nan=False)
    source_start_sec: float = Field(default=0, ge=0, allow_inf_nan=False)
    crossfade_ms: float = Field(default=30, ge=0, le=1000, allow_inf_nan=False)
    match_level: bool = False


@app.get("/health")
def health() -> dict:
    version = ffmpeg.ffmpeg_version()
    return {"status": "ok" if version else "degraded", "ffmpeg": version, "dataRoot": str(DATA_ROOT)}


@app.post("/probe")
def probe(req: PathRequest) -> dict:
    try:
        result = ffmpeg.probe(existing_file(req.path))
    except ffmpeg.FfmpegError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "durationSec": result.duration_sec,
        "sampleRate": result.sample_rate,
        "channels": result.channels,
        "codec": result.codec,
        "format": result.format,
    }


@app.post("/convert")
def convert(req: ConvertRequest) -> dict:
    src = existing_file(req.src)
    dst = resolve_in_data_root(req.dst)
    if dst.exists():
        raise HTTPException(status_code=409, detail="destination exists; assets are immutable")
    try:
        ffmpeg.convert_to_wav(src, dst, req.sample_rate, req.channels)
        result = ffmpeg.probe(dst)
    except ffmpeg.FfmpegError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "path": req.dst,
        "durationSec": result.duration_sec,
        "sampleRate": result.sample_rate,
        "channels": result.channels,
    }


@app.post("/peaks")
def peaks(req: PeaksRequest) -> dict:
    path = existing_file(req.path)
    try:
        samples = ffmpeg.decode_mono(path, PEAKS_SAMPLE_RATE)
    except ffmpeg.FfmpegError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "durationSec": samples.size / PEAKS_SAMPLE_RATE,
        "peaks": compute_peaks(samples, req.points),
    }


@app.post("/prepare")
def prepare(req: PrepareRequest) -> dict:
    src, dst = existing_file(req.src), resolve_in_data_root(req.dst)
    try:
        if dst.exists():
            raise FileExistsError(dst)
        info = ffmpeg.probe(src)
        if not 0 < info.duration_sec <= 180:
            raise ValueError("哼唱时长需在 0–180 秒之间")
        samples = ffmpeg.decode_mono(src, RATE)
        prepared, processing = prepare_samples(samples, RATE, req.trim_silence, req.normalize)
        # Downsample with FFmpeg after publication for consistent anti-aliasing.
        write_wav_immutable(dst, prepared, RATE)
        try:
            analysis = melody_analysis(ffmpeg.decode_mono(dst, 16000))
        except Exception:
            dst.unlink(missing_ok=True)
            raise
        return {"path": req.dst, "durationSec": len(prepared) / RATE, "sampleRate": RATE, "channels": 1,
                "processing": processing, "analysis": analysis}
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="destination exists; assets are immutable") from exc
    except (ValueError, ffmpeg.FfmpegError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/analyze")
def analyze(req: PathRequest) -> dict:
    src = existing_file(req.path)
    try:
        if not 0 < ffmpeg.probe(src).duration_sec <= 180:
            raise ValueError("旋律分析支持最长 180 秒音频")
        return melody_analysis(ffmpeg.decode_mono(src, 16000))
    except (ValueError, ffmpeg.FfmpegError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/replace")
def replace(req: ReplaceRequest) -> dict:
    base, replacement, dst = existing_file(req.base), existing_file(req.replacement), resolve_in_data_root(req.dst)
    try:
        if dst.exists():
            raise FileExistsError(dst)
        original, source = decode_stereo(base), decode_stereo(replacement)
        result, metadata = replace_segment(original, source, req.start_sec, req.end_sec,
                                           req.source_start_sec, req.crossfade_ms, req.match_level)
        write_wav_immutable(dst, result, RATE, float_pcm=True)
        return {"path": req.dst, "durationSec": len(result) / RATE, "metadata": metadata}
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="destination exists; assets are immutable") from exc
    except (ValueError, ffmpeg.FfmpegError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
