import logging
import os
import threading
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

from app.generator import (
    LICENSE,
    MAX_SECONDS,
    USAGE,
    AudioGenerator,
    GeneratorBusy,
    GeneratorUnavailable,
    MusicGenGenerator,
    encode_wav,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # The first download is ~2 GB; loading at startup keeps the first request from timing out.
    if os.environ.get("MUSICGEN_PRELOAD", "").lower() in ("1", "true", "yes"):
        generator = default_generator()
        warm = getattr(generator, "warm", None)
        if warm:
            threading.Thread(target=_warm_quietly, args=(warm,), daemon=True).start()
    yield


def _warm_quietly(warm) -> None:
    try:
        warm()
    except Exception:  # noqa: BLE001 - requests report the reason when they try again
        logging.getLogger(__name__).exception("Preloading the MusicGen model failed")


app = FastAPI(title="Synaptix Prototype Audio Generation", version="0.1.0", lifespan=lifespan)


class AudioGenerationRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)
    durationSeconds: float = Field(default=10, ge=1, le=MAX_SECONDS)
    seed: int = Field(default=1, ge=0, le=2_147_483_647)
    # How closely to follow the prompt; MusicGen's usual default is 3.
    guidance: float = Field(default=3.0, ge=1, le=10)


@lru_cache
def default_generator() -> AudioGenerator:
    return MusicGenGenerator(os.environ.get("MUSICGEN_MODEL", "facebook/musicgen-small"))


Generator = Annotated[AudioGenerator, Depends(default_generator)]


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
def readyz(generator: Generator) -> dict[str, object]:
    return {
        "status": "ready",
        "model": generator.model_id,
        "loaded": generator.loaded,
        "loading": getattr(generator, "loading", False),
        "device": generator.device,
        "license": LICENSE,
        "usage": USAGE,
    }


@app.post("/audio/generations", response_class=Response)
def generate(request: AudioGenerationRequest, generator: Generator) -> Response:
    try:
        audio = generator.generate(
            request.prompt, request.durationSeconds, request.seed, request.guidance
        )
    except GeneratorBusy as error:
        raise HTTPException(
            status_code=429,
            detail=f"The GPU is busy ({error}). Try again in a moment.",
        ) from error
    except GeneratorUnavailable as error:
        raise HTTPException(
            status_code=503, detail=f"Prototype audio generation is unavailable: {error}."
        ) from error
    return Response(
        content=encode_wav(audio.samples, audio.sample_rate),
        media_type="audio/wav",
        headers={
            "X-Synaptix-Model": audio.model,
            "X-Synaptix-License": LICENSE,
            "X-Synaptix-Usage": USAGE,
            "X-Synaptix-Duration-Seconds": f"{audio.samples.size / audio.sample_rate:.2f}",
            "X-Synaptix-Generation-Seconds": f"{audio.generation_seconds:.1f}",
            "X-Synaptix-Seed": str(request.seed),
            "Cache-Control": "no-store",
        },
    )
