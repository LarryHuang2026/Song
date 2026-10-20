from __future__ import annotations

import importlib
import math
import struct
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.peaks import compute_peaks


def write_sine(path: Path, freq: float, seconds: float, rate: int = 44100, amp: float = 0.5) -> None:
    n = int(seconds * rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = b"".join(
            struct.pack("<h", int(amp * 32767 * math.sin(2 * math.pi * freq * i / rate))) for i in range(n)
        )
        w.writeframes(frames)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_DATA_ROOT", str(tmp_path))
    import app.main as main

    importlib.reload(main)
    return TestClient(main.app), tmp_path


def test_compute_peaks_buckets():
    samples = np.array([0.1, -0.9, 0.2, 0.3, -0.4, 0.05], dtype=np.float32)
    assert compute_peaks(samples, 3) == [0.9, 0.3, 0.4]


def test_compute_peaks_empty():
    assert compute_peaks(np.array([], dtype=np.float32), 4) == [0.0, 0.0, 0.0, 0.0]


def test_health(client):
    c, _ = client
    body = c.get("/health").json()
    assert body["status"] == "ok"
    assert body["ffmpeg"].startswith("ffmpeg version")


def test_probe_and_peaks(client):
    c, root = client
    write_sine(root / "tone.wav", 440, 1.0)
    probe = c.post("/probe", json={"path": "tone.wav"}).json()
    assert probe["sampleRate"] == 44100
    assert probe["channels"] == 1
    assert abs(probe["durationSec"] - 1.0) < 0.01

    peaks = c.post("/peaks", json={"path": "tone.wav", "points": 50}).json()
    assert len(peaks["peaks"]) == 50
    assert all(0.45 < p <= 0.51 for p in peaks["peaks"])


def test_convert_creates_new_file_and_refuses_overwrite(client):
    c, root = client
    write_sine(root / "in.wav", 220, 0.5, rate=22050)
    res = c.post("/convert", json={"src": "in.wav", "dst": "out/norm.wav"})
    assert res.status_code == 200
    body = res.json()
    assert body["sampleRate"] == 44100 and body["channels"] == 2
    assert (root / "out" / "norm.wav").is_file()

    again = c.post("/convert", json={"src": "in.wav", "dst": "out/norm.wav"})
    assert again.status_code == 409


def test_rejects_path_escape(client):
    c, _ = client
    res = c.post("/probe", json={"path": "../../etc/hosts"})
    assert res.status_code == 400


def test_missing_file(client):
    c, _ = client
    assert c.post("/probe", json={"path": "nope.wav"}).status_code == 404
