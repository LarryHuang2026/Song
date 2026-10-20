from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np


class FfmpegError(RuntimeError):
    pass


def _require(binary: str) -> str:
    path = shutil.which(binary)
    if path is None:
        raise FfmpegError(f"{binary} not found in PATH")
    return path


def ffmpeg_version() -> str | None:
    try:
        out = subprocess.run(
            [_require("ffmpeg"), "-version"], capture_output=True, text=True, check=True, timeout=10
        )
    except (FfmpegError, subprocess.SubprocessError):
        return None
    return out.stdout.splitlines()[0] if out.stdout else None


@dataclass(frozen=True)
class ProbeResult:
    duration_sec: float
    sample_rate: int
    channels: int
    codec: str
    format: str


def probe(path: Path) -> ProbeResult:
    proc = subprocess.run(
        [
            _require("ffprobe"),
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels:format=duration,format_name",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise FfmpegError(proc.stderr.strip() or "ffprobe failed")
    info = json.loads(proc.stdout)
    streams = info.get("streams") or []
    if not streams:
        raise FfmpegError("no audio stream")
    stream = streams[0]
    fmt = info.get("format", {})
    return ProbeResult(
        duration_sec=float(fmt["duration"]) if fmt.get("duration") else decode_mono(path, 1000).size / 1000,
        sample_rate=int(stream.get("sample_rate", 0)),
        channels=int(stream.get("channels", 0)),
        codec=str(stream.get("codec_name", "")),
        format=str(fmt.get("format_name", "")),
    )


def convert_to_wav(src: Path, dst: Path, sample_rate: int, channels: int) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".part")
    proc = subprocess.run(
        [
            _require("ffmpeg"),
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-i",
            str(src),
            "-vn",
            "-ac",
            str(channels),
            "-ar",
            str(sample_rate),
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            str(tmp),
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise FfmpegError(proc.stderr.strip() or "ffmpeg convert failed")
    tmp.replace(dst)


def decode_mono(path: Path, sample_rate: int) -> np.ndarray:
    proc = subprocess.run(
        [
            _require("ffmpeg"),
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-t",
            "3601",
            "-f",
            "f32le",
            "pipe:1",
        ],
        capture_output=True,
        timeout=600,
    )
    if proc.returncode != 0:
        raise FfmpegError(proc.stderr.decode(errors="replace").strip() or "ffmpeg decode failed")
    return np.frombuffer(proc.stdout, dtype=np.float32)
