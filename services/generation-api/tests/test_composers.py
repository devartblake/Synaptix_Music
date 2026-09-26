from types import SimpleNamespace

import pytest

from app.generation.composers import (
    ClaudeComposer,
    LocalComposer,
    ProceduralComposer,
    compose_arrangement,
    composer_from_env,
)
from app.generation.plan import ArrangementPlan, PlanRenderError, render_plan
from app.generation.procedural import MINOR_SCALE, ROOT_MIDI_BY_KEY, TICKS_PER_BAR
from app.models.generation import GenerationProposal, GenerationRequest


def plan_json(bars: tuple[int, ...] = (4, 8, 2, 2)) -> dict:
    kinds = ["intro", "main", "tension", "victory", "main", "main"]
    return {
        "title": "Quiz Rush",
        "sections": [
            {
                "kind": kinds[index],
                "name": f"Part {index}",
                "bars": length,
                "energy": 0.4 + index * 0.15,
                "chords": [0, 5, 3, 6],
                "harmony": ["sustained", "stabs", "arpeggio", "sustained"][index % 4],
                "bass": "x...x...x.o.x...",
                "drums": {
                    "kick": "X...x...X...x...",
                    "snare": "....x.......x...",
                    "hat": "x.x.x.x.x.x.x.x.",
                },
                "melody": [
                    [
                        {"step": 0, "degree": 4, "length": 4, "accent": True},
                        {"step": 8, "degree": 7, "length": 2},
                    ],
                    [
                        {"step": 0, "degree": 2, "length": 8},
                        {"step": 12, "degree": -3, "length": 20},
                    ],
                ],
            }
            for index, length in enumerate(bars)
        ],
    }


def request(**overrides) -> GenerationRequest:
    values = {"projectId": "project-1", "key": "D minor", "durationBars": 16, "brief": "boss fight"}
    values.update(overrides)
    return GenerationRequest(**values)


def all_notes(proposal: GenerationProposal):
    for track in proposal.tracks:
        for clip in track.clips:
            yield track.role, clip, clip.notes


def test_rendered_plan_is_a_valid_in_key_arrangement() -> None:
    proposal = render_plan(
        request(),
        ArrangementPlan.model_validate(plan_json()),
        generator_id="synaptix-claude-composer",
        generator_version="1.0.0",
        model="claude-opus-5",
    )
    assert GenerationProposal.model_validate(proposal.model_dump()) == proposal
    assert [section.bars for section in proposal.sections] == [4, 8, 2, 2]
    assert proposal.provenance.generatorId == "synaptix-claude-composer"
    assert proposal.provenance.model == "claude-opus-5"

    scale = {(ROOT_MIDI_BY_KEY["D minor"] + step) % 12 for step in MINOR_SCALE}
    for role, clip, notes in all_notes(proposal):
        assert notes, role
        for note in notes:
            assert (
                note.startTick + note.durationTicks
                <= clip.range.durationTicks
                == 16 * TICKS_PER_BAR
            )
            if role != "drums":
                assert note.pitch % 12 in scale, (role, note.pitch)


def test_section_lengths_are_scaled_to_the_requested_duration() -> None:
    proposal = render_plan(
        request(durationBars=32),
        ArrangementPlan.model_validate(plan_json((3, 3, 3))),
        generator_id="synaptix-claude-composer",
        generator_version="1.0.0",
    )
    assert sum(section.bars for section in proposal.sections) == 32
    assert [section.bars for section in proposal.sections] == [10, 11, 11]


def test_messy_patterns_are_normalized_rather_than_rejected() -> None:
    data = plan_json()
    data["sections"][0]["bass"] = "x"
    data["sections"][0]["drums"]["hat"] = "x" * 40
    data["sections"][0]["chords"] = [9, -2]
    data["sections"][0]["melody"] = []
    proposal = render_plan(
        request(),
        ArrangementPlan.model_validate(data),
        generator_id="synaptix-claude-composer",
        generator_version="1.0.0",
    )
    assert proposal.tracks[0].clips[0].notes


def test_plans_with_too_few_sections_are_rejected() -> None:
    with pytest.raises(PlanRenderError):
        render_plan(
            request(),
            ArrangementPlan.model_validate(plan_json((8, 8))),
            generator_id="synaptix-claude-composer",
            generator_version="1.0.0",
        )


class FakeStream:
    def __init__(self, message) -> None:
        self.message = message

    def __enter__(self):
        return self

    def __exit__(self, *_) -> None:
        return None

    def get_final_message(self):
        return self.message


class FakeClient:
    def __init__(self, message) -> None:
        self.calls: list[dict] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))
        self._message = message

    def _stream(self, **kwargs):
        self.calls.append(kwargs)
        return FakeStream(self._message)


def claude_message(stop_reason="end_turn", plan=None):
    parsed = ArrangementPlan.model_validate(plan or plan_json())
    return SimpleNamespace(stop_reason=stop_reason, parsed_output=parsed, model="claude-opus-5")


def test_claude_composer_sends_the_brief_with_fallbacks_and_structured_output() -> None:
    client = FakeClient(claude_message())
    proposal = compose_arrangement(request(), ClaudeComposer(client=client))

    call = client.calls[0]
    assert call["model"] == "claude-opus-5"
    assert call["output_format"] is ArrangementPlan
    assert call["fallbacks"] == "default"
    assert call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["thinking"] == {"type": "adaptive"}
    assert "Creative brief: boss fight" in call["messages"][0]["content"]
    assert proposal.provenance.generatorId == "synaptix-claude-composer"
    assert proposal.warnings == []


@pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens"])
def test_claude_refusals_and_truncation_fall_back_to_procedural(stop_reason: str) -> None:
    proposal = compose_arrangement(
        request(), ClaudeComposer(client=FakeClient(claude_message(stop_reason)))
    )
    assert proposal.provenance.generatorId == "synaptix-procedural-composer"
    assert "Claude composer was unavailable" in proposal.warnings[-1]


def test_network_errors_fall_back_without_leaking_details() -> None:
    class Broken:
        beta = SimpleNamespace(
            messages=SimpleNamespace(
                stream=lambda **_: (_ for _ in ()).throw(
                    ConnectionError("https://api.example/secret?key=abc")
                )
            )
        )

    proposal = compose_arrangement(request(), ClaudeComposer(client=Broken()))
    assert proposal.provenance.generatorId == "synaptix-procedural-composer"
    assert "ConnectionError" in proposal.warnings[-1]
    assert "secret" not in proposal.warnings[-1]


def test_unfit_plans_fall_back_to_procedural() -> None:
    client = FakeClient(claude_message(plan=plan_json((8, 8))))
    proposal = compose_arrangement(request(), ClaudeComposer(client=client))
    assert proposal.provenance.generatorId == "synaptix-procedural-composer"


def test_composer_selection_from_the_environment() -> None:
    assert isinstance(composer_from_env({}), ProceduralComposer)
    assert isinstance(composer_from_env({"SYNAPTIX_COMPOSER": "local"}), LocalComposer)
    assert isinstance(composer_from_env({"SYNAPTIX_COMPOSER": "nonsense"}), ProceduralComposer)


def test_procedural_errors_still_surface() -> None:
    class Broken(ProceduralComposer):
        def compose(self, request):
            raise RuntimeError("bug")

    with pytest.raises(RuntimeError):
        compose_arrangement(request(), Broken())


def test_api_failures_are_explained_in_plain_words() -> None:
    import anthropic
    import httpx

    def raising(error):
        class Client:
            beta = SimpleNamespace(
                messages=SimpleNamespace(stream=lambda **_: (_ for _ in ()).throw(error))
            )

        return Client()

    no_key = TypeError("Could not resolve authentication method. Expected one of api_key")
    proposal = compose_arrangement(request(), ClaudeComposer(client=raising(no_key)))
    assert "no Anthropic API key is configured" in proposal.warnings[-1]

    response = httpx.Response(429, request=httpx.Request("POST", "https://api.anthropic.com"))
    limited = anthropic.RateLimitError("slow down", response=response, body=None)
    proposal = compose_arrangement(request(), ClaudeComposer(client=raising(limited)))
    assert "rate limiting" in proposal.warnings[-1]


def local_composer(handler) -> LocalComposer:
    import httpx

    client = httpx.Client(base_url="http://ollama.test", transport=httpx.MockTransport(handler))
    return LocalComposer(model="qwen2.5:7b", http=client)


def test_local_composer_sends_schema_and_renders_the_plan() -> None:
    import json

    import httpx

    seen: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(json.loads(req.content))
        return httpx.Response(200, json={"message": {"content": json.dumps(plan_json())}})

    proposal = compose_arrangement(request(seed=42), local_composer(handler))

    assert seen["model"] == "qwen2.5:7b"
    assert seen["format"]["title"] == "ArrangementPlan"
    assert seen["options"]["seed"] == 42
    assert "Creative brief: boss fight" in seen["messages"][1]["content"]
    assert proposal.provenance.generatorId == "synaptix-local-composer"
    assert proposal.provenance.model == "qwen2.5:7b"
    assert proposal.warnings == []


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        ("missing", "is not downloaded yet"),
        ("error", "returned an error (500)"),
        ("garbage", "did not return a valid arrangement plan"),
        ("timeout", "took too long"),
        ("offline", "could not be reached"),
    ],
)
def test_local_failures_fall_back_with_a_plain_reason(response: str, reason: str) -> None:
    import httpx

    def handler(req: httpx.Request) -> httpx.Response:
        if response == "timeout":
            raise httpx.ReadTimeout("slow", request=req)
        if response == "offline":
            raise httpx.ConnectError("refused", request=req)
        if response == "missing":
            return httpx.Response(404, json={"error": "model not found"})
        if response == "error":
            return httpx.Response(500, json={"error": "boom"})
        return httpx.Response(200, json={"message": {"content": "{not a plan"}})

    proposal = compose_arrangement(request(), local_composer(handler))
    assert proposal.provenance.generatorId == "synaptix-procedural-composer"
    assert reason in proposal.warnings[-1]
