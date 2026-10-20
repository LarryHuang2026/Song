from __future__ import annotations

import os
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

from . import ffmpeg

RATE = 44100


def decode_stereo(path: Path, max_seconds: float = 600) -> np.ndarray:
    info = ffmpeg.probe(path)
    if info.duration_sec <= 0 or info.duration_sec > max_seconds:
        raise ValueError(f"音频时长必须在 0–{max_seconds:g} 秒之间")
    proc = subprocess.run([ffmpeg._require("ffmpeg"), "-nostdin", "-v", "error", "-i", str(path), "-vn", "-ac", "2", "-ar", str(RATE), "-f", "f32le", "pipe:1"], capture_output=True, timeout=120)
    if proc.returncode:
        raise ffmpeg.FfmpegError("音频解码失败")
    return np.frombuffer(proc.stdout, dtype="<f4").reshape(-1, 2).copy()


def write_wav_immutable(dst: Path, samples: np.ndarray, rate: int, float_pcm: bool = False) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".audio-", suffix=".part", dir=dst.parent)
    os.close(fd)
    temp = Path(tmp_name)
    try:
        if float_pcm:
            # Float WAV retains every decoded outside-region sample, without quantization.
            proc = subprocess.run([ffmpeg._require("ffmpeg"), "-nostdin", "-y", "-v", "error", "-f", "f32le", "-ar", str(rate), "-ac", str(samples.shape[1]), "-i", "pipe:0", "-c:a", "pcm_f32le", "-f", "wav", str(temp)], input=np.asarray(samples, dtype="<f4").tobytes(), capture_output=True, timeout=120)
            if proc.returncode:
                raise ffmpeg.FfmpegError("WAV 写入失败")
        else:
            with wave.open(str(temp), "wb") as output:
                output.setnchannels(1 if samples.ndim == 1 else samples.shape[1])
                output.setsampwidth(2)
                output.setframerate(rate)
                output.writeframes(np.round(np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
        os.link(temp, dst)  # Atomic publication; never overwrite an existing asset.
    finally:
        temp.unlink(missing_ok=True)


def replace_segment(base: np.ndarray, replacement: np.ndarray, start_sec: float, end_sec: float,
                    source_start_sec: float, crossfade_ms: float, match_level: bool = False) -> tuple[np.ndarray, dict]:
    if not np.isfinite([start_sec, end_sec, source_start_sec, crossfade_ms]).all():
        raise ValueError("时间参数必须为有限数值")
    start, end, source_start = (round(v * RATE) for v in (start_sec, end_sec, source_start_sec))
    length = end - start
    if start < 0 or end > base.shape[0] or length < round(0.05 * RATE) or source_start < 0:
        raise ValueError("替换区间需至少 50 毫秒，且必须位于原曲范围内")
    if source_start + length > replacement.shape[0]:
        raise ValueError("替换素材长度不足；请选择更长素材或缩短区间，不会自动拉伸或循环")
    if crossfade_ms < 0 or crossfade_ms > 1000:
        raise ValueError("交叉淡化需在 0–1000 毫秒之间")
    fade = min(round(crossfade_ms * RATE / 1000), length // 2)
    segment = replacement[source_start:source_start + length].copy()
    gain = 1.0
    if match_level:
        original_rms = float(np.sqrt(np.mean(base[start:end] ** 2)))
        segment_rms = float(np.sqrt(np.mean(segment ** 2)))
        if segment_rms > 1e-8 and original_rms > 1e-8:
            gain = float(np.clip(original_rms / segment_rms, 0.25, 4.0))
    peak = float(np.max(np.abs(segment)))
    if peak > 0:
        gain = min(gain, 0.99 / peak)
    segment *= gain
    result = base.copy()
    result[start:end] = segment
    if fade:
        ramp = np.linspace(0, 1, fade, dtype=np.float32)[:, None]
        result[start:start + fade] = base[start:start + fade] * (1 - ramp) + segment[:fade] * ramp
        result[end - fade:end] = segment[-fade:] * (1 - ramp) + base[end - fade:end] * ramp
    return result, {"startSec": start / RATE, "endSec": end / RATE, "sourceStartSec": source_start / RATE,
                    "crossfadeMs": fade * 1000 / RATE, "gain": round(gain, 6),
                    "outsideRegionUnchanged": bool(np.array_equal(result[:start], base[:start]) and np.array_equal(result[end:], base[end:])),
                    "peak": float(np.max(np.abs(result))), "sampleRate": RATE,
                    "note": "本地等长片段替换；交叉淡化位于选区内部，未执行 AI 生成、节拍对齐、调性校正或时间拉伸。"}
