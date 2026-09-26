import io
import threading
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.generator import GeneratedAudio, GeneratorBusy, GeneratorUnavailable, encode_wav
from app.main import app, default_generator


class FakeGenerator:
    model_id = "fake/musicgen"
    device = "cpu"
    loaded = True

    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[tuple[str, float, int, float]] = []
        self.error = error

    def generate(self, prompt: str, seconds: float, seed: int, guidance: float) -> GeneratedAudio:
        self.calls.append((prompt, seconds, seed, guidance))
        if self.error:
            raise self.error
        rate = 32000
        t = np.arange(int(seconds * rate)) / rate
        return GeneratedAudio(0.2 * np.sin(2 * np.pi * 440 * t), rate, self.model_id, 1.5)


@pytest.fixture
def client_with():
    def make(generator: FakeGenerator) -> TestClient:
        app.dependency_overrides[default_generator] = lambda: generator
        return TestClient(app)

    yield make
    app.dependency_overrides.clear()


def read_wav(data: bytes) -> tuple[int, int, np.ndarray]:
    with wave.open(io.BytesIO(data)) as audio:
        frames = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2")
        return audio.getframerate(), audio.getnchannels(), frames


def test_generates_a_wav_labelled_prototype_only(client_with) -> None:
    generator = FakeGenerator()
    response = client_with(generator).post(
        "/audio/generations",
        json={"prompt": "upbeat chiptune route theme", "durationSeconds": 2, "seed": 7},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["x-synaptix-license"] == "CC-BY-NC-4.0"
    assert response.headers["x-synaptix-usage"] == "prototype-only"
    assert response.headers["x-synaptix-model"] == "fake/musicgen"
    assert response.headers["x-synaptix-duration-seconds"] == "2.00"
    rate, channels, frames = read_wav(response.content)
    assert (rate, channels, frames.size) == (32000, 1, 64000)
    assert generator.calls == [("upbeat chiptune route theme", 2.0, 7, 3.0)]


@pytest.mark.parametrize(
    "body",
    [
        {"prompt": ""},
        {"prompt": "x" * 501},
        {"prompt": "ok", "durationSeconds": 31},
        {"prompt": "ok", "durationSeconds": 0.5},
        {"prompt": "ok", "guidance": 0},
    ],
)
def test_rejects_invalid_requests(client_with, body) -> None:
    assert client_with(FakeGenerator()).post("/audio/generations", json=body).status_code == 422


def test_a_busy_gpu_answers_429(client_with) -> None:
    response = client_with(FakeGenerator(GeneratorBusy("busy"))).post(
        "/audio/generations", json={"prompt": "ok"}
    )
    assert response.status_code == 429
    assert response.json()["detail"] == "The GPU is busy (busy). Try again in a moment."


def test_an_unavailable_model_answers_503_in_plain_words(client_with) -> None:
    error = GeneratorUnavailable("the model 'x' couldn't be loaded")
    response = client_with(FakeGenerator(error)).post("/audio/generations", json={"prompt": "ok"})
    assert response.status_code == 503
    assert "couldn't be loaded" in response.json()["detail"]


def test_readiness_reports_the_model_and_its_licence(client_with) -> None:
    body = client_with(FakeGenerator()).get("/readyz").json()
    assert body["model"] == "fake/musicgen"
    assert body["license"] == "CC-BY-NC-4.0"
    assert body["usage"] == "prototype-only"


def test_wav_encoding_normalises_the_peak_and_survives_silence_and_nan() -> None:
    _, _, loud = read_wav(encode_wav(np.array([0.0, 2.5, -1.0]), 8000))
    assert abs(int(np.max(np.abs(loud))) - round(32767 * 10 ** (-1 / 20))) <= 1
    _, _, silent = read_wav(encode_wav(np.zeros(10), 8000))
    assert not silent.any()
    _, _, broken = read_wav(encode_wav(np.array([np.nan, 0.5]), 8000))
    assert broken.size == 2


def test_the_real_generator_allows_one_generation_at_a_time() -> None:
    from app.generator import MusicGenGenerator

    generator = MusicGenGenerator("unused")
    generator._lock.acquire()
    try:
        with pytest.raises(GeneratorBusy):
            generator.generate("x", 1, 1, 3)
    finally:
        generator._lock.release()


def test_the_real_generator_reports_a_missing_model_stack_plainly() -> None:
    from app.generator import MusicGenGenerator

    generator = MusicGenGenerator("unused")
    try:
        import torch  # noqa: F401
    except ImportError:
        with pytest.raises(GeneratorUnavailable, match="aren't installed"):
            generator.generate("x", 1, 1, 3)
    assert not generator._lock.locked(), threading.current_thread()


def test_a_loading_model_says_so_instead_of_generating() -> None:
    from app.generator import MusicGenGenerator

    generator = MusicGenGenerator("unused")
    generator._loading = True
    generator._lock.acquire()
    try:
        with pytest.raises(GeneratorBusy, match="still loading"):
            generator.generate("x", 1, 1, 3)
    finally:
        generator._lock.release()


def test_preload_warms_the_generator_at_startup(monkeypatch) -> None:
    warmed = threading.Event()

    class Warmable(FakeGenerator):
        def warm(self) -> None:
            warmed.set()

    monkeypatch.setenv("MUSICGEN_PRELOAD", "true")
    monkeypatch.setattr("app.main.default_generator", lambda: Warmable())
    with TestClient(app):
        assert warmed.wait(timeout=5)
