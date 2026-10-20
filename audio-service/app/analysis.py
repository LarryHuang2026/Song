"""Local monophonic pitch and amplitude-onset tempo estimates; no remote models."""
from __future__ import annotations

import math
import numpy as np


def melody_analysis(samples: np.ndarray, rate: int = 16000) -> dict:
    frame, hop = 2048, 640
    points = []
    # Difference-function pitch estimator (YIN family), 50–1000 Hz.
    low, high = max(2, rate // 1000), min(frame // 2, rate // 50)
    for start in range(0, max(1, samples.size - frame + 1), hop):
        x = np.asarray(samples[start:start + frame], dtype=np.float64)
        if x.size < frame:
            x = np.pad(x, (0, frame - x.size))
        rms = float(np.sqrt(np.mean(x * x)))
        hz, confidence = None, 0.0
        if rms >= 0.003:
            x -= x.mean()
            spectrum = np.fft.rfft(x, frame * 2)
            ac = np.fft.irfft(spectrum * spectrum.conj())[:high + 1]
            squares = np.concatenate(([0.0], np.cumsum(x * x)))
            lags = np.arange(1, high + 1)
            diff = np.maximum(0, squares[frame - lags] + squares[frame] - squares[lags] - 2 * ac[1:])
            cmnd = np.ones(high + 1)
            cmnd[1:] = diff * lags / np.maximum(np.cumsum(diff), 1e-12)
            candidates = np.flatnonzero(cmnd[low:high] < 0.18)
            if candidates.size:
                lag = int(candidates[0] + low)
                while lag < high - 1 and cmnd[lag + 1] < cmnd[lag]:
                    lag += 1
                confidence = float(max(0, 1 - cmnd[lag]))
                denom = cmnd[lag - 1] - 2 * cmnd[lag] + cmnd[lag + 1]
                shift = 0.5 * (cmnd[lag - 1] - cmnd[lag + 1]) / denom if abs(denom) > 1e-12 else 0
                hz = round(float(rate / (lag + np.clip(shift, -0.5, 0.5))), 2)
        points.append({"timeSec": round((start + frame / 2) / rate, 4), "hz": hz, "confidence": round(confidence, 3)})
    voiced = [p["hz"] for p in points if p["hz"] is not None]
    warnings = []
    if samples.size / rate < 2:
        warnings.append("哼唱较短，建议录制至少 2 秒。")
    rms_total = float(np.sqrt(np.mean(samples * samples))) if samples.size else 0.0
    if rms_total < 0.008:
        warnings.append("音量偏小，请靠近麦克风，或开启响度归一化。")
    voiced_ratio = len(voiced) / max(1, len(points))
    if voiced_ratio < 0.2:
        warnings.append("可识别的单音旋律较少；伴奏、噪声或多声部会影响分析。")
    bpm, tempo_confidence = estimate_tempo(samples, rate)
    return {"method": "YIN 差分估计 / 振幅起音自相关", "pitch": points, "voicedRatio": round(voiced_ratio, 3),
            "medianHz": round(float(np.median(voiced)), 2) if voiced else None,
            "bpm": bpm, "tempoConfidence": round(tempo_confidence, 3), "warnings": warnings,
            "note": "仅作单声部旋律参考；BPM 为振幅起音估计，可能出现半速/倍速，弱节奏哼唱不提供可靠速度。"}


def estimate_tempo(samples: np.ndarray, rate: int) -> tuple[float | None, float]:
    hop = rate // 100
    n = samples.size // hop
    if n < 400:
        return None, 0.0
    envelope = np.sqrt(np.mean(samples[:n * hop].reshape(n, hop) ** 2, axis=1))
    onset = np.maximum(0, np.diff(envelope, prepend=envelope[0]))
    if float(onset.max()) < 0.005:
        return None, 0.0
    onset = np.maximum(0, onset - np.mean(onset))
    energy = float(np.dot(onset, onset))
    if energy < 1e-8:
        return None, 0.0
    lags = np.arange(30, 101)
    scores = np.array([np.dot(onset[:-lag], onset[lag:]) / energy for lag in lags])
    best = int(np.argmax(scores))
    confidence = float(scores[best])
    return (round(6000 / int(lags[best]), 1), confidence) if confidence > 0.25 else (None, confidence)


def prepare_samples(samples: np.ndarray, rate: int, trim: bool, normalize: bool) -> tuple[np.ndarray, dict]:
    start, end = 0, samples.size
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if trim and peak > 1e-5:
        # Retain a 50 ms margin and ignore isolated excursions shorter than 20 ms.
        window = max(1, rate // 100)
        n = samples.size // window
        blocks = samples[:n * window].reshape(n, window)
        energy = np.sqrt(np.mean(blocks ** 2, axis=1))
        active = np.flatnonzero(energy > max(0.003, peak * 0.02))
        if active.size:
            start = max(0, int(active[0] * window) - rate // 20)
            end = min(samples.size, int((active[-1] + 1) * window) + rate // 20)
    result = samples[start:end].copy()
    gain = 1.0
    if normalize and result.size:
        rms = float(np.sqrt(np.mean(result ** 2)))
        out_peak = float(np.max(np.abs(result)))
        if rms > 1e-5 and out_peak > 0:
            gain = min(10 ** (-20 / 20) / rms, 0.95 / out_peak, 20.0)
            result *= gain
    return result, {"trimStartSec": round(start / rate, 4), "trimEndSec": round((samples.size - end) / rate, 4), "gainDb": round(20 * math.log10(gain), 2)}
