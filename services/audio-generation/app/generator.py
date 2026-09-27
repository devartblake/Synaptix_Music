"""Text-to-audio generators.

MusicGen weights are licensed CC-BY-NC 4.0, so everything this service produces is for
prototyping only: it must not be published, sold or shipped in a game build.
"""

import io
import threading
import time
import wave
from dataclasses import dataclass
from typing import Protocol

import numpy as np

LICENSE = "CC-BY-NC-4.0"
USAGE = "prototype-only"
MAX_SECONDS = 30.0


@dataclass(frozen=True)
class GeneratedAudio:
    samples: np.ndarray
    """Mono float samples in [-1, 1]."""
    sample_rate: int
    model: str
    generation_seconds: float


class AudioGenerator(Protocol):
    model_id: str

    @property
    def device(self) -> str: ...

    @property
    def loaded(self) -> bool: ...

    def generate(
        self, prompt: str, seconds: float, seed: int, guidance: float
    ) -> GeneratedAudio: ...


class GeneratorBusy(RuntimeError):
    """Another generation is using the GPU."""


class GeneratorUnavailable(RuntimeError):
    """The model couldn't be loaded (missing GPU, no network to download weights, ...)."""


class MusicGenGenerator:
    """MusicGen through Hugging Face transformers. The model loads on first use."""

    def __init__(self, model_id: str = "facebook/musicgen-small") -> None:
        self.model_id = model_id
        self._model = None
        self._processor = None
        self._device = "unloaded"
        self._loading = False
        self._lock = threading.Lock()

    @property
    def device(self) -> str:
        return self._device

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _load(self) -> None:
        try:
            import torch
            from transformers import AutoProcessor, MusicgenForConditionalGeneration
        except ImportError as error:  # The test image has no PyTorch.
            raise GeneratorUnavailable("PyTorch and transformers aren't installed") from error
        device = "cuda" if torch.cuda.is_available() else "cpu"
        try:
            self._processor = AutoProcessor.from_pretrained(self.model_id)
            model = MusicgenForConditionalGeneration.from_pretrained(
                self.model_id, torch_dtype=torch.float16 if device == "cuda" else torch.float32
            )
        except Exception as error:  # noqa: BLE001 - surfaced to the caller in plain words
            raise GeneratorUnavailable(f"the model '{self.model_id}' couldn't be loaded") from error
        self._model = model.to(device)
        self._device = device

    @property
    def loading(self) -> bool:
        return self._loading

    def warm(self) -> None:
        """Download and load the model ahead of the first request (run in the background)."""
        with self._lock:
            if self._model is None:
                self._loading = True
                try:
                    self._load()
                finally:
                    self._loading = False

    def generate(self, prompt: str, seconds: float, seed: int, guidance: float) -> GeneratedAudio:
        if not self._lock.acquire(blocking=False):
            raise GeneratorBusy(
                "the model is still loading"
                if self._loading
                else "another generation is in progress"
            )
        try:
            if self._model is None:
                self._load()
            import torch

            started = time.perf_counter()
            torch.manual_seed(seed)
            config = self._model.config.audio_encoder
            inputs = self._processor(text=[prompt], padding=True, return_tensors="pt").to(
                self._device
            )
            with torch.inference_mode():
                audio = self._model.generate(
                    **inputs,
                    do_sample=True,
                    guidance_scale=guidance,
                    max_new_tokens=max(1, round(seconds * config.frame_rate)),
                )
            samples = audio[0, 0].float().cpu().numpy()
            return GeneratedAudio(
                samples=samples,
                sample_rate=int(config.sampling_rate),
                model=self.model_id,
                generation_seconds=time.perf_counter() - started,
            )
        finally:
            self._lock.release()


def encode_wav(samples: np.ndarray, sample_rate: int, peak_dbfs: float = -1.0) -> bytes:
    """16-bit mono WAV, peak-normalised so quiet or hot model output is usable as-is."""
    samples = np.nan_to_num(np.asarray(samples, dtype=np.float64).reshape(-1))
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > 0:
        samples = samples * (10 ** (peak_dbfs / 20) / peak)
    pcm = np.clip(np.round(samples * 32767), -32768, 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm.tobytes())
    return buffer.getvalue()
