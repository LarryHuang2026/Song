from __future__ import annotations

import numpy as np


def compute_peaks(samples: np.ndarray, points: int) -> list[float]:
    """Max absolute amplitude per bucket, rounded for compact JSON."""
    if points <= 0:
        raise ValueError("points must be positive")
    if samples.size == 0:
        return [0.0] * points
    edges = np.linspace(0, samples.size, points + 1).astype(np.int64)
    out = np.zeros(points, dtype=np.float32)
    abs_samples = np.abs(samples)
    for i in range(points):
        start, end = edges[i], edges[i + 1]
        if end > start:
            out[i] = abs_samples[start:end].max()
    return [round(float(v), 4) for v in np.clip(out, 0.0, 1.0)]
