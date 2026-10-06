import json
import logging
import os
import threading
import time
from collections.abc import Iterator
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse
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
from app.jobs import (
    CANCELLED,
    QUEUED,
    TERMINAL_STATUSES,
    JobStore,
    JobWorker,
    MemoryJobStore,
    RedisJobStore,
    is_job_id,
    new_job,
    public_view,
)


def _enabled(name: str, default: str = "") -> bool:
    return os.environ.get(name, default).lower() in ("1", "true", "yes")


@asynccontextmanager
async def lifespan(application: FastAPI):
    # The first download is ~2 GB; loading at startup keeps the first request from timing out.
    if _enabled("MUSICGEN_PRELOAD"):
        generator = default_generator()
        warm = getattr(generator, "warm", None)
        if warm:
            threading.Thread(target=_warm_quietly, args=(warm,), daemon=True).start()
    stop = threading.Event()
    if _enabled("AUDIO_JOBS_WORKER", "true"):
        # Resolved per job, so tests can swap the store and generator.
        def resolve(dependency):
            return lambda: application.dependency_overrides.get(dependency, dependency)()

        worker = JobWorker(resolve(default_store), resolve(default_generator))
        threading.Thread(target=worker.run_forever, args=(stop,), daemon=True).start()
    yield
    stop.set()


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


@lru_cache
def default_store() -> JobStore:
    """Redis when REDIS_URL is set (jobs survive restarts); otherwise this process's memory."""
    url = os.environ.get("REDIS_URL", "").strip()
    if not url:
        return MemoryJobStore()
    import redis

    return RedisJobStore(redis.Redis.from_url(url))


Store = Annotated[JobStore, Depends(default_store)]


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
        "jobs": True,
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


# ---- Queued jobs with live progress -------------------------------------------------------

EVENT_POLL_SECONDS = 0.25
EVENT_KEEPALIVE_SECONDS = 15.0
EVENT_STREAM_MAX_SECONDS = 1800.0


def _job_or_404(store: JobStore, job_id: str) -> dict:
    job = store.get(job_id) if is_job_id(job_id) else None
    if job is None:
        raise HTTPException(status_code=404, detail="This prototype audio job doesn't exist.")
    return job


@app.post("/audio/jobs", status_code=202)
def submit_job(request: AudioGenerationRequest, store: Store) -> dict[str, object]:
    job = new_job(request.prompt, request.durationSeconds, request.seed, request.guidance)
    store.create(job)
    return public_view(job, store)


@app.get("/audio/jobs/{job_id}")
def job_status(job_id: str, store: Store) -> dict[str, object]:
    return public_view(_job_or_404(store, job_id), store)


@app.delete("/audio/jobs/{job_id}")
def cancel_job(job_id: str, store: Store) -> dict[str, object]:
    job = _job_or_404(store, job_id)
    if job["status"] != QUEUED:
        raise HTTPException(status_code=409, detail="Only a queued job can be cancelled.")
    return public_view(store.update(job_id, status=CANCELLED) or job, store)


@app.get("/audio/jobs/{job_id}/events")
def job_events(job_id: str, store: Store) -> StreamingResponse:
    """Server-sent events: the job's status each time it changes, ending when it finishes."""
    _job_or_404(store, job_id)

    def stream() -> Iterator[str]:
        last_seen: tuple[object, ...] | None = None
        started = last_sent = time.monotonic()
        while time.monotonic() - started < EVENT_STREAM_MAX_SECONDS:
            job = store.get(job_id)
            if job is None:
                yield "event: gone\ndata: {}\n\n"
                return
            view = public_view(job, store)
            key = (view["status"], view["progress"], view["position"], view["error"])
            if key != last_seen:
                last_seen = key
                last_sent = time.monotonic()
                yield f"event: status\ndata: {json.dumps(view)}\n\n"
                if view["status"] in TERMINAL_STATUSES:
                    return
            elif time.monotonic() - last_sent > EVENT_KEEPALIVE_SECONDS:
                last_sent = time.monotonic()
                yield ": keep-alive\n\n"
            time.sleep(EVENT_POLL_SECONDS)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@app.get("/audio/jobs/{job_id}/audio", response_class=Response)
def job_audio(job_id: str, store: Store) -> Response:
    job = _job_or_404(store, job_id)
    wav = store.get_audio(job_id) if job["status"] == "completed" else None
    if wav is None:
        raise HTTPException(status_code=409, detail="This job has no audio yet.")
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={
            "X-Synaptix-Model": job.get("model") or "",
            "X-Synaptix-License": LICENSE,
            "X-Synaptix-Usage": USAGE,
            "X-Synaptix-Duration-Seconds": f"{job.get('audioSeconds') or 0:.2f}",
            "X-Synaptix-Generation-Seconds": f"{job.get('generationSeconds') or 0:.1f}",
            "X-Synaptix-Seed": str(job.get("seed")),
            "Cache-Control": "no-store",
        },
    )
