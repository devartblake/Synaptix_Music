from fastapi.testclient import TestClient

from app.generation.procedural import TICKS_PER_BAR, generate_arrangement
from app.main import app
from app.models.generation import GenerationRequest


def request(seed: int = 42) -> GenerationRequest:
    return GenerationRequest(
        projectId="project-test",
        genre="electronic-trivia",
        mood="upbeat",
        tempo=120,
        key="D minor",
        durationBars=16,
        energy=0.7,
        complexity=0.6,
        seed=seed,
    )


def test_same_seed_produces_identical_proposal() -> None:
    first = generate_arrangement(request())
    second = generate_arrangement(request())

    assert first.model_dump(mode="json") == second.model_dump(mode="json")


def test_different_seed_changes_generated_notes() -> None:
    first = generate_arrangement(request(seed=42))
    second = generate_arrangement(request(seed=43))

    first_melody = next(t for t in first.tracks if t.role == "melody").clips[0].notes
    second_melody = next(t for t in second.tracks if t.role == "melody").clips[0].notes
    assert first_melody != second_melody


def test_proposal_has_expected_structure_and_duration() -> None:
    proposal = generate_arrangement(request())

    roles = [track.role for track in proposal.tracks]
    # The core parts always play, in this order; the mood and mode add supporting layers.
    assert [role for role in roles if role in ("drums", "bass", "harmony", "melody")] == [
        "drums",
        "bass",
        "harmony",
        "melody",
    ]
    assert len(set(roles)) == len(roles)
    assert sum(section.bars for section in proposal.sections) == 16
    assert all(
        track.clips[0].range.durationTicks == 16 * TICKS_PER_BAR for track in proposal.tracks
    )
    assert all(track.clips[0].notes for track in proposal.tracks)
    assert proposal.provenance.seed == 42


def test_api_returns_valid_generation_proposal() -> None:
    client = TestClient(app)
    response = client.post(
        "/generation/projects",
        json=request().model_dump(mode="json"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["operation"] == "create-arrangement"
    assert payload["projectId"] == "project-test"
    assert {"drums", "bass", "harmony", "melody"} <= {track["role"] for track in payload["tracks"]}


def test_api_rejects_unsupported_tempo() -> None:
    client = TestClient(app)
    payload = request().model_dump(mode="json")
    payload["tempo"] = 201

    response = client.post("/generation/projects", json=payload)

    assert response.status_code == 422
