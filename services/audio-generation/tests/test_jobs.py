import json
import threading
import time

import fakeredis
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.generator import GeneratedAudio, GeneratorBusy, GeneratorUnavailable, ProgressStreamer
from app.jobs import (
    COMPLETED,
    FAILED,
    GENERATING,
    QUEUED,
    JobWorker,
    MemoryJobStore,
    RedisJobStore,
    new_job,
)
from app.main import app, default_generator, default_store


class ProgressGenerator:
    """Reports progress in steps; can be held mid-generation to watch a job in flight."""

    model_id = "fake/musicgen"
    device = "cpu"

    def __init__(self, errors: list[Exception] | None = None, loaded: bool = True) -> None:
        self.errors = list(errors or [])
        self.loaded = loaded
        self.hold = threading.Event()
        self.hold.set()
        self.halfway = threading.Event()
        self.calls = 0

    def generate(self, prompt, seconds, seed, guidance, on_progress=None) -> GeneratedAudio:
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        self.loaded = True
        for step in range(1, 11):
            if on_progress:
                on_progress(step / 10)
            if step == 5:
                self.halfway.set()
                self.hold.wait(5)
        rate = 8000
        samples = 0.3 * np.sin(np.arange(int(seconds * rate)) / 5)
        return GeneratedAudio(samples, rate, self.model_id, 0.7)


@pytest.fixture(params=["memory", "redis"])
def store(request):
    if request.param == "memory":
        return MemoryJobStore()
    return RedisJobStore(fakeredis.FakeRedis())


def worker_for(store, generator, **options) -> JobWorker:
    return JobWorker(lambda: store, lambda: generator, sleep=lambda _: None, **options)


def test_jobs_run_in_order_and_report_queue_position(store) -> None:
    first, second = new_job("a", 1, 1, 3), new_job("b", 1, 2, 3)
    store.create(first)
    store.create(second)
    assert (store.position(first["jobId"]), store.position(second["jobId"])) == (0, 1)

    worker = worker_for(store, ProgressGenerator())
    assert worker.run_once(timeout=0.1)
    done = store.get(first["jobId"])
    assert done["status"] == COMPLETED and done["progress"] == 1.0
    assert done["audioSeconds"] == 1.0 and done["model"] == "fake/musicgen"
    assert store.get_audio(first["jobId"])[:4] == b"RIFF"
    assert store.position(second["jobId"]) == 0
    assert store.get(second["jobId"])["status"] == QUEUED


def test_an_empty_queue_returns_without_work(store) -> None:
    assert not worker_for(store, ProgressGenerator()).run_once(timeout=0.1)


def test_progress_is_written_while_generating(store) -> None:
    job = new_job("a", 1, 1, 3)
    store.create(job)
    generator = ProgressGenerator()
    generator.hold.clear()
    worker = worker_for(store, generator)
    thread = threading.Thread(target=worker.run_once, kwargs={"timeout": 0.1})
    thread.start()
    assert generator.halfway.wait(5)
    midway = store.get(job["jobId"])
    assert midway["status"] == GENERATING
    assert midway["progress"] == 0.5
    assert midway["attempts"] == 1
    generator.hold.set()
    thread.join(5)
    assert store.get(job["jobId"])["status"] == COMPLETED


def test_a_loading_model_waits_instead_of_failing(store) -> None:
    job = new_job("a", 1, 1, 3)
    store.create(job)
    generator = ProgressGenerator([GeneratorBusy("loading"), GeneratorBusy("loading")], False)
    worker_for(store, generator).run_once(timeout=0.1)
    assert store.get(job["jobId"])["status"] == COMPLETED
    assert generator.calls == 3


def test_failures_are_reported_in_plain_words(store) -> None:
    unavailable, broken, busy = (new_job(name, 1, 1, 3) for name in "abc")
    for job in (unavailable, broken, busy):
        store.create(job)
    worker_for(store, ProgressGenerator([GeneratorUnavailable("no GPU")])).run_once(0.1)
    worker_for(store, ProgressGenerator([ValueError("bad tensor")])).run_once(0.1)
    worker_for(store, ProgressGenerator([GeneratorBusy("x")] * 5), load_wait=2).run_once(0.1)
    assert store.get(unavailable["jobId"])["error"] == "Prototype audio is unavailable: no GPU."
    assert store.get(broken["jobId"])["error"] == "Generation failed: bad tensor."
    assert store.get(busy["jobId"])["status"] == FAILED
    assert store.running() == []


def test_a_job_abandoned_by_a_stopped_worker_is_retried_then_failed(store) -> None:
    job = new_job("a", 1, 1, 3)
    store.create(job)
    assert store.claim(0.1) == job["jobId"]
    store.update(job["jobId"], status=GENERATING, attempts=1, heartbeatAt=time.time() - 600)

    worker = worker_for(store, ProgressGenerator())
    worker.recover_stale()
    assert store.get(job["jobId"])["status"] == QUEUED
    assert store.position(job["jobId"]) == 0

    assert store.claim(0.1) == job["jobId"]
    store.update(job["jobId"], status=GENERATING, attempts=2, heartbeatAt=time.time() - 600)
    worker.recover_stale()
    assert store.get(job["jobId"])["status"] == FAILED


def test_a_live_job_is_not_mistaken_for_abandoned(store) -> None:
    job = new_job("a", 1, 1, 3)
    store.create(job)
    store.claim(0.1)
    store.update(job["jobId"], status=GENERATING, attempts=1, heartbeatAt=time.time())
    worker_for(store, ProgressGenerator()).recover_stale()
    assert store.get(job["jobId"])["status"] == GENERATING


def test_redis_jobs_survive_a_new_store_instance() -> None:
    server = fakeredis.FakeServer()
    job = new_job("a", 1, 1, 3)
    RedisJobStore(fakeredis.FakeRedis(server=server)).create(job)
    restarted = RedisJobStore(fakeredis.FakeRedis(server=server))
    assert restarted.get(job["jobId"])["prompt"] == "a"
    assert restarted.claim(0.1) == job["jobId"]


def test_the_progress_streamer_counts_generated_steps() -> None:
    seen: list[float] = []
    streamer = ProgressStreamer(4, seen.append)
    for _ in range(5):  # the prompt, then four steps
        streamer.put(object())
    streamer.end()
    assert seen == [0.25, 0.5, 0.75, 0.99, 1.0]


# ---- HTTP API -----------------------------------------------------------------------------


@pytest.fixture
def api():
    store = MemoryJobStore()
    generator = ProgressGenerator()
    app.dependency_overrides[default_store] = lambda: store
    app.dependency_overrides[default_generator] = lambda: generator
    yield TestClient(app), store, generator
    app.dependency_overrides.clear()


def test_submit_status_and_audio_over_http(api) -> None:
    client, store, generator = api
    submitted = client.post("/audio/jobs", json={"prompt": "lofi", "durationSeconds": 2, "seed": 4})
    assert submitted.status_code == 202
    job_id = submitted.json()["jobId"]
    assert submitted.json()["status"] == QUEUED and submitted.json()["position"] == 0
    assert client.get(f"/audio/jobs/{job_id}/audio").status_code == 409

    worker_for(store, generator).run_once(0.1)
    status = client.get(f"/audio/jobs/{job_id}").json()
    assert status["status"] == COMPLETED
    assert status["result"] == {
        "model": "fake/musicgen",
        "audioSeconds": 2.0,
        "generationSeconds": 0.7,
    }
    audio = client.get(f"/audio/jobs/{job_id}/audio")
    assert audio.headers["content-type"] == "audio/wav"
    assert audio.headers["x-synaptix-usage"] == "prototype-only"
    assert audio.headers["x-synaptix-seed"] == "4"
    assert audio.content[:4] == b"RIFF"


def test_unknown_and_malformed_job_ids_are_not_found(api) -> None:
    client, _, _ = api
    assert client.get("/audio/jobs/" + "0" * 32).status_code == 404
    assert client.get("/audio/jobs/not-a-job").status_code == 404
    assert client.get("/audio/jobs/../readyz/events").status_code == 404
    assert client.post("/audio/jobs", json={"prompt": ""}).status_code == 422


def test_only_queued_jobs_can_be_cancelled(api) -> None:
    client, store, generator = api
    first = client.post("/audio/jobs", json={"prompt": "a"}).json()["jobId"]
    second = client.post("/audio/jobs", json={"prompt": "b"}).json()["jobId"]
    assert client.delete(f"/audio/jobs/{second}").json()["status"] == "cancelled"
    worker = worker_for(store, generator)
    worker.run_once(0.1)
    assert client.delete(f"/audio/jobs/{first}").status_code == 409
    assert not worker.run_once(0.1), "the cancelled job left the queue"


def test_the_event_stream_follows_a_job_to_completion(api) -> None:
    client, store, generator = api
    job_id = client.post("/audio/jobs", json={"prompt": "a", "durationSeconds": 1}).json()["jobId"]
    # The test client buffers a stream until it ends, so the job runs alongside: held halfway
    # for a moment, so the stream sees it in flight, then released.
    generator.hold.clear()
    threading.Timer(0.8, generator.hold.set).start()
    thread = threading.Thread(target=worker_for(store, generator).run_once, args=(1.0,))
    thread.start()
    with client.stream("GET", f"/audio/jobs/{job_id}/events") as response:
        assert response.headers["content-type"].startswith("text/event-stream")
        events = [
            json.loads(line[6:]) for line in response.iter_lines() if line.startswith("data: ")
        ]
    thread.join(5)
    statuses = [event["status"] for event in events]
    assert statuses[-1] == COMPLETED
    assert GENERATING in statuses
    assert 0 < next(e["progress"] for e in events if e["status"] == GENERATING) < 1
    progress = [event["progress"] for event in events]
    assert progress == sorted(progress), "progress never goes backwards"


def test_a_finished_job_streams_one_event_and_closes(api) -> None:
    client, store, generator = api
    job_id = client.post("/audio/jobs", json={"prompt": "a", "durationSeconds": 1}).json()["jobId"]
    worker_for(store, generator).run_once(0.1)
    with client.stream("GET", f"/audio/jobs/{job_id}/events") as response:
        lines = [line for line in response.iter_lines() if line]
    assert lines[0] == "event: status"
    assert json.loads(lines[1][6:])["status"] == COMPLETED
    assert len(lines) == 2


def test_the_service_worker_runs_jobs_in_the_background(api) -> None:
    client, store, _ = api
    with TestClient(app) as running:
        job_id = running.post("/audio/jobs", json={"prompt": "a", "durationSeconds": 1}).json()[
            "jobId"
        ]
        deadline = time.time() + 10
        while time.time() < deadline and store.get(job_id)["status"] != COMPLETED:
            time.sleep(0.05)
        assert running.get(f"/audio/jobs/{job_id}").json()["status"] == COMPLETED
