"""Queued prototype-audio jobs with live progress.

A generation takes from seconds to minutes, so the studio submits a job, follows its progress
over a server-sent event stream and downloads the WAV when it's done, instead of holding one
HTTP request open. Jobs live in Redis when REDIS_URL is set (they survive a service restart
and several API processes can share one queue); otherwise in this process's memory.

One worker thread per process runs jobs one at a time, because the model needs the whole GPU.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable
from typing import Any, Protocol

from app.generator import AudioGenerator, GeneratorBusy, GeneratorUnavailable, encode_wav

QUEUED = "queued"
LOADING = "loading"
GENERATING = "generating"
COMPLETED = "completed"
FAILED = "failed"
CANCELLED = "cancelled"
ACTIVE_STATUSES = (QUEUED, LOADING, GENERATING)
TERMINAL_STATUSES = (COMPLETED, FAILED, CANCELLED)

# Finished jobs and their audio are kept for an hour; anything else for a day.
FINISHED_TTL_SECONDS = 3600
ACTIVE_TTL_SECONDS = 86_400
# A running job whose worker hasn't reported for this long is put back in the queue.
STALE_AFTER_SECONDS = 120.0
MAX_ATTEMPTS = 2
# How long a job waits for the model to finish loading before it fails.
LOAD_WAIT_SECONDS = 900.0

_INT_FIELDS = ("seed", "attempts", "version")
_FLOAT_FIELDS = (
    "durationSeconds",
    "guidance",
    "progress",
    "createdAt",
    "updatedAt",
    "heartbeatAt",
    "audioSeconds",
    "generationSeconds",
)

logger = logging.getLogger(__name__)


def new_job_id() -> str:
    return uuid.uuid4().hex


def is_job_id(value: str) -> bool:
    return len(value) == 32 and all(char in "0123456789abcdef" for char in value)


def _decode(raw: dict[Any, Any]) -> dict[str, Any]:
    job: dict[str, Any] = {}
    for key, value in raw.items():
        name = key.decode() if isinstance(key, bytes) else key
        text = value.decode() if isinstance(value, bytes) else value
        if text == "":
            job[name] = None
        elif name in _INT_FIELDS:
            job[name] = int(text)
        elif name in _FLOAT_FIELDS:
            job[name] = float(text)
        else:
            job[name] = text
    return job


def _encode(fields: dict[str, Any]) -> dict[str, str]:
    return {key: "" if value is None else str(value) for key, value in fields.items()}


class JobStore(Protocol):
    def create(self, job: dict[str, Any]) -> None: ...
    def get(self, job_id: str) -> dict[str, Any] | None: ...
    def update(self, job_id: str, **fields: Any) -> dict[str, Any] | None: ...
    def claim(self, timeout: float) -> str | None: ...
    def position(self, job_id: str) -> int | None: ...
    def requeue(self, job_id: str) -> None: ...
    def running(self) -> list[str]: ...
    def put_audio(self, job_id: str, wav: bytes) -> None: ...
    def get_audio(self, job_id: str) -> bytes | None: ...


class MemoryJobStore:
    """Jobs in this process only; used when no REDIS_URL is configured, and in tests."""

    def __init__(self) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}
        self._audio: dict[str, bytes] = {}
        self._queue: deque[str] = deque()
        self._running: set[str] = set()
        self._changed = threading.Condition()

    def create(self, job: dict[str, Any]) -> None:
        with self._changed:
            self._jobs[job["jobId"]] = dict(job)
            self._queue.append(job["jobId"])
            self._changed.notify_all()

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._changed:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def update(self, job_id: str, **fields: Any) -> dict[str, Any] | None:
        with self._changed:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            job.update(fields)
            job["version"] = job.get("version", 0) + 1
            job["updatedAt"] = time.time()
            if job["status"] in TERMINAL_STATUSES:
                self._running.discard(job_id)
                if job_id in self._queue:
                    self._queue.remove(job_id)
            return dict(job)

    def claim(self, timeout: float) -> str | None:
        with self._changed:
            if not self._queue:
                self._changed.wait(timeout)
            if not self._queue:
                return None
            job_id = self._queue.popleft()
            self._running.add(job_id)
            return job_id

    def position(self, job_id: str) -> int | None:
        with self._changed:
            return self._queue.index(job_id) if job_id in self._queue else None

    def requeue(self, job_id: str) -> None:
        with self._changed:
            self._running.discard(job_id)
            if job_id not in self._queue:
                self._queue.appendleft(job_id)
            self._changed.notify_all()

    def running(self) -> list[str]:
        with self._changed:
            return list(self._running)

    def put_audio(self, job_id: str, wav: bytes) -> None:
        with self._changed:
            self._audio[job_id] = wav

    def get_audio(self, job_id: str) -> bytes | None:
        with self._changed:
            return self._audio.get(job_id)


class RedisJobStore:
    """Jobs in Redis: a hash per job, a FIFO list for the queue and a set of running jobs."""

    def __init__(self, client: Any, prefix: str = "synaptix:audio-jobs:") -> None:
        self._redis = client
        self._prefix = prefix

    def _job_key(self, job_id: str) -> str:
        return f"{self._prefix}job:{job_id}"

    def _audio_key(self, job_id: str) -> str:
        return f"{self._prefix}audio:{job_id}"

    @property
    def _queue_key(self) -> str:
        return f"{self._prefix}queue"

    @property
    def _running_key(self) -> str:
        return f"{self._prefix}running"

    def create(self, job: dict[str, Any]) -> None:
        key = self._job_key(job["jobId"])
        pipe = self._redis.pipeline()
        pipe.hset(key, mapping=_encode(job))
        pipe.expire(key, ACTIVE_TTL_SECONDS)
        pipe.rpush(self._queue_key, job["jobId"])
        pipe.execute()

    def get(self, job_id: str) -> dict[str, Any] | None:
        raw = self._redis.hgetall(self._job_key(job_id))
        return _decode(raw) if raw else None

    def update(self, job_id: str, **fields: Any) -> dict[str, Any] | None:
        key = self._job_key(job_id)
        if not self._redis.exists(key):
            return None
        fields = {**fields, "updatedAt": time.time()}
        pipe = self._redis.pipeline()
        pipe.hset(key, mapping=_encode(fields))
        pipe.hincrby(key, "version", 1)
        status = fields.get("status")
        if status in TERMINAL_STATUSES:
            pipe.srem(self._running_key, job_id)
            pipe.lrem(self._queue_key, 0, job_id)
            pipe.expire(key, FINISHED_TTL_SECONDS)
        pipe.execute()
        return self.get(job_id)

    def claim(self, timeout: float) -> str | None:
        popped = self._redis.blpop([self._queue_key], timeout=max(1, round(timeout)))
        if popped is None:
            return None
        raw = popped[1]
        job_id = raw.decode() if isinstance(raw, bytes) else raw
        self._redis.sadd(self._running_key, job_id)
        return job_id

    def position(self, job_id: str) -> int | None:
        queued = [
            item.decode() if isinstance(item, bytes) else item
            for item in self._redis.lrange(self._queue_key, 0, -1)
        ]
        return queued.index(job_id) if job_id in queued else None

    def requeue(self, job_id: str) -> None:
        pipe = self._redis.pipeline()
        pipe.srem(self._running_key, job_id)
        pipe.lrem(self._queue_key, 0, job_id)
        pipe.lpush(self._queue_key, job_id)
        pipe.execute()

    def running(self) -> list[str]:
        return [
            item.decode() if isinstance(item, bytes) else item
            for item in self._redis.smembers(self._running_key)
        ]

    def put_audio(self, job_id: str, wav: bytes) -> None:
        self._redis.set(self._audio_key(job_id), wav, ex=FINISHED_TTL_SECONDS)

    def get_audio(self, job_id: str) -> bytes | None:
        return self._redis.get(self._audio_key(job_id))


def new_job(prompt: str, duration_seconds: float, seed: int, guidance: float) -> dict[str, Any]:
    now = time.time()
    return {
        "jobId": new_job_id(),
        "status": QUEUED,
        "progress": 0.0,
        "prompt": prompt,
        "durationSeconds": duration_seconds,
        "seed": seed,
        "guidance": guidance,
        "attempts": 0,
        "version": 1,
        "createdAt": now,
        "updatedAt": now,
        "heartbeatAt": None,
        "error": None,
        "model": None,
        "audioSeconds": None,
        "generationSeconds": None,
    }


def public_view(job: dict[str, Any], store: JobStore) -> dict[str, Any]:
    """What clients see: status and progress, never internal bookkeeping."""
    view = {
        "jobId": job["jobId"],
        "status": job["status"],
        "progress": round(float(job.get("progress") or 0.0), 3),
        "position": store.position(job["jobId"]) if job["status"] == QUEUED else None,
        "durationSeconds": job.get("durationSeconds"),
        "seed": job.get("seed"),
        "error": job.get("error"),
        "version": job.get("version", 0),
    }
    if job["status"] == COMPLETED:
        view["result"] = {
            "model": job.get("model"),
            "audioSeconds": job.get("audioSeconds"),
            "generationSeconds": job.get("generationSeconds"),
        }
    return view


class JobWorker:
    """Takes queued jobs one at a time and runs them on the generator."""

    def __init__(
        self,
        store_factory: Callable[[], JobStore],
        generator_factory: Callable[[], AudioGenerator],
        *,
        stale_after: float = STALE_AFTER_SECONDS,
        load_wait: float = LOAD_WAIT_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._store_factory = store_factory
        self._generator_factory = generator_factory
        self._stale_after = stale_after
        self._load_wait = load_wait
        self._sleep = sleep

    def recover_stale(self) -> None:
        """Put back jobs whose worker stopped reporting (e.g. the process was restarted)."""
        store = self._store_factory()
        now = time.time()
        for job_id in store.running():
            job = store.get(job_id)
            if job is None or job["status"] in TERMINAL_STATUSES:
                continue
            last = job.get("heartbeatAt") or job.get("updatedAt") or 0
            if now - last < self._stale_after:
                continue
            if job.get("attempts", 0) >= MAX_ATTEMPTS:
                store.update(job_id, status=FAILED, error="The audio service stopped twice.")
            else:
                store.update(job_id, status=QUEUED, progress=0.0)
                store.requeue(job_id)

    def run_once(self, timeout: float = 1.0) -> bool:
        """Run the next queued job, if there is one within `timeout` seconds."""
        store = self._store_factory()
        job_id = store.claim(timeout)
        if job_id is None:
            return False
        job = store.get(job_id)
        if job is None or job["status"] != QUEUED:
            return True  # Cancelled or expired while waiting.
        self._run(store, job)
        return True

    def run_forever(self, stop: threading.Event) -> None:
        while not stop.is_set():
            try:
                self.recover_stale()
                self.run_once(timeout=2.0)
            except Exception:  # noqa: BLE001 - e.g. Redis restarting; try again shortly
                logger.exception("The prototype audio worker hit an error")
                stop.wait(2.0)

    def _run(self, store: JobStore, job: dict[str, Any]) -> None:
        job_id = job["jobId"]
        generator = self._generator_factory()
        store.update(
            job_id,
            status=GENERATING if generator.loaded else LOADING,
            attempts=job.get("attempts", 0) + 1,
            heartbeatAt=time.time(),
            progress=0.0,
        )
        last_report = [0.0, -1.0]

        def on_progress(fraction: float) -> None:
            now = time.time()
            fraction = max(0.0, min(1.0, fraction))
            # Throttle writes: every 2 % or every half second.
            if fraction - last_report[1] < 0.02 and now - last_report[0] < 0.5:
                return
            last_report[:] = [now, fraction]
            store.update(job_id, status=GENERATING, progress=round(fraction, 3), heartbeatAt=now)

        # Keep the job visibly alive while the model downloads or loads (no progress yet).
        stop_heartbeat = threading.Event()

        def heartbeat() -> None:
            while not stop_heartbeat.wait(15.0):
                store.update(job_id, heartbeatAt=time.time())

        threading.Thread(target=heartbeat, daemon=True).start()
        try:
            self._generate(store, job, generator, on_progress)
        finally:
            stop_heartbeat.set()

    def _generate(
        self,
        store: JobStore,
        job: dict[str, Any],
        generator: AudioGenerator,
        on_progress: Callable[[float], None],
    ) -> None:
        job_id = job["jobId"]
        waited = 0.0
        while True:
            try:
                audio = generator.generate(
                    job["prompt"],
                    job["durationSeconds"],
                    job["seed"],
                    job["guidance"],
                    on_progress=on_progress,
                )
                break
            except GeneratorBusy as error:
                # The model is still loading at startup (or the direct endpoint is in use).
                if waited >= self._load_wait:
                    store.update(job_id, status=FAILED, error=f"The GPU stayed busy ({error}).")
                    return
                store.update(job_id, status=LOADING, heartbeatAt=time.time())
                self._sleep(1.0)
                waited += 1.0
            except GeneratorUnavailable as error:
                store.update(
                    job_id, status=FAILED, error=f"Prototype audio is unavailable: {error}."
                )
                return
            except Exception as error:  # noqa: BLE001 - reported to the studio in plain words
                logger.exception("Prototype audio job %s failed", job_id)
                store.update(job_id, status=FAILED, error=f"Generation failed: {error}.")
                return

        store.put_audio(job_id, encode_wav(audio.samples, audio.sample_rate))
        store.update(
            job_id,
            status=COMPLETED,
            progress=1.0,
            model=audio.model,
            audioSeconds=round(audio.samples.size / audio.sample_rate, 2),
            generationSeconds=round(audio.generation_seconds, 1),
        )
