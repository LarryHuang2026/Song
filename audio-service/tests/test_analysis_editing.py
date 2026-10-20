from __future__ import annotations

import hashlib
import math
import subprocess

import numpy as np
import pytest

from app.analysis import melody_analysis, prepare_samples
from app.editing import RATE, decode_stereo, replace_segment, write_wav_immutable
from test_service import client, write_sine


@pytest.mark.parametrize("frequency", [82.41, 130.81, 220, 440, 659.25])
def test_known_pitch_with_harmonics(frequency):
    t = np.arange(16000 * 2) / 16000
    samples = (0.3 * np.sin(2 * np.pi * frequency * t) + 0.12 * np.sin(4 * np.pi * frequency * t)).astype(np.float32)
    result = melody_analysis(samples)
    assert result["voicedRatio"] > 0.9
    assert abs(1200 * math.log2(result["medianHz"] / frequency)) < 50


def test_silence_is_not_a_melody_or_tempo():
    result = melody_analysis(np.zeros(16000 * 5, dtype=np.float32))
    assert result["medianHz"] is None and result["bpm"] is None
    assert result["voicedRatio"] == 0 and result["warnings"]


def test_regular_clicks_estimate_tempo():
    samples = np.zeros(16000 * 10, dtype=np.float32)
    for start in range(0, samples.size - 800, 8000):
        samples[start:start + 800] = 0.6 * np.sin(np.arange(800) * 2 * np.pi * 440 / 16000) * np.exp(-np.arange(800) / 120)
    result = melody_analysis(samples)
    assert result["bpm"] == pytest.approx(120, abs=3)


def test_trim_and_normalize_only_create_derived_file(client):
    c, root = client
    samples = np.concatenate([np.zeros(RATE), 0.01 * np.sin(np.arange(RATE) * 2 * np.pi * 220 / RATE), np.zeros(RATE)])
    write_wav_immutable(root / "hum.wav", samples, RATE)
    original_hash = hashlib.sha256((root / "hum.wav").read_bytes()).hexdigest()
    res = c.post("/prepare", json={"src": "hum.wav", "dst": "prepared.wav"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert 1 < body["durationSec"] < 1.2
    assert body["processing"]["gainDb"] > 5
    assert body["analysis"]["medianHz"] == pytest.approx(220, abs=2)
    assert hashlib.sha256((root / "hum.wav").read_bytes()).hexdigest() == original_hash
    assert c.post("/prepare", json={"src": "hum.wav", "dst": "prepared.wav"}).status_code == 409
    assert c.post("/prepare", json={"src": "hum.wav", "dst": "../escape.wav"}).status_code == 400


def test_browser_webm_recording_can_be_prepared(client):
    c, root = client
    write_sine(root / "input.wav", 220, 2)
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(root / "input.wav"), "-c:a", "libopus", str(root / "recording.webm")], check=True)
    res = c.post("/prepare", json={"src": "recording.webm", "dst": "recording-normal.wav"})
    assert res.status_code == 200, res.text
    assert res.json()["analysis"]["medianHz"] == pytest.approx(220, abs=3)


def test_null_replacement_and_outside_region_exact_equality(tmp_path):
    rng = np.random.default_rng(5)
    base = rng.uniform(-0.6, 0.6, (RATE * 3, 2)).astype(np.float32)
    same, _ = replace_segment(base, base, 0.5, 2, 0.5, 0)
    assert np.array_equal(base, same)
    replacement = np.full((RATE * 3, 2), 0.8, dtype=np.float32)
    result, meta = replace_segment(base, replacement, 0.5, 2, 0, 35)
    start, end = RATE // 2, RATE * 2
    assert np.array_equal(result[:start], base[:start])
    assert np.array_equal(result[end:], base[end:])
    assert np.max(np.abs(result)) <= 1 and meta["outsideRegionUnchanged"]
    assert np.array_equal(result[start], base[start])
    assert np.array_equal(result[end - 1], base[end - 1])
    write_wav_immutable(tmp_path / "edit.wav", result, RATE, float_pcm=True)
    # Float WAV re-decodes identically, including the entire area outside the edit.
    assert np.array_equal(decode_stereo(tmp_path / "edit.wav"), result)


def test_invalid_ranges_and_short_source_are_rejected():
    base = np.zeros((RATE * 3, 2), dtype=np.float32)
    for start, end, offset in [(2, 1, 0), (-1, 1, 0), (0, 4, 0), (0, .01, 0), (0, 2, 2), (0, 2, float("nan"))]:
        with pytest.raises(ValueError):
            replace_segment(base, base, start, end, offset, 30)


def test_replace_endpoint_does_not_modify_parents(client):
    c, root = client
    write_sine(root / "base.wav", 220, 3)
    write_sine(root / "source.wav", 440, 3)
    before = (root / "base.wav").read_bytes()
    request = {"base": "base.wav", "replacement": "source.wav", "dst": "edit.wav", "start_sec": 0.5, "end_sec": 1.5, "crossfade_ms": 30}
    res = c.post("/replace", json=request)
    assert res.status_code == 200, res.text
    assert res.json()["metadata"]["outsideRegionUnchanged"]
    assert res.json()["durationSec"] == pytest.approx(3)
    assert (root / "base.wav").read_bytes() == before
    assert c.post("/replace", json=request).status_code == 409
