"""Publication rules v1, phase 1: every proposal carries licence facts from the reviewed table.

Publishing refuses music whose provenance says ``not-allowed``, so these facts must never come from
the model itself, and anything not reviewed must fail closed.
"""

import json

import httpx

from app.generation.composers import (
    ClaudeComposer,
    LocalComposer,
    ProceduralComposer,
    compose_arrangement,
)
from app.generation.licensing import licence_for
from tests.test_composers import FakeClient, claude_message, plan_json, request


def test_claude_output_is_commercial_under_anthropics_terms() -> None:
    proposal = compose_arrangement(request(), ClaudeComposer(client=FakeClient(claude_message())))
    provenance = proposal.provenance
    assert provenance.generatorId == "synaptix-claude-composer"
    assert provenance.model == "claude-opus-5"
    assert (provenance.licence, provenance.commercialUse) == (
        "Anthropic-Commercial-Terms",
        "allowed",
    )
    assert provenance.credits == []
    assert provenance.planSha256 is not None and len(provenance.planSha256) == 64


def test_the_procedural_fallback_carries_the_procedural_licence_not_the_failed_composer() -> None:
    proposal = compose_arrangement(
        request(), ClaudeComposer(client=FakeClient(claude_message("refusal")))
    )
    assert proposal.provenance.generatorId == "synaptix-procedural-composer"
    assert (proposal.provenance.licence, proposal.provenance.commercialUse) == ("none", "allowed")


def test_local_models_are_allowed_only_when_their_exact_tag_was_reviewed() -> None:
    assert licence_for("synaptix-local-composer", "qwen2.5:7b") == ("Apache-2.0", "allowed", ())
    # Other sizes of the same family can carry a different licence, so they fail closed.
    assert licence_for("synaptix-local-composer", "qwen2.5:72b")[1] == "not-allowed"
    assert licence_for("synaptix-local-composer", None) == ("unreviewed", "not-allowed", ())

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message": {"content": json.dumps(plan_json())}})

    http = httpx.Client(base_url="http://ollama.test", transport=httpx.MockTransport(handler))
    composer = LocalComposer(model="mystery:13b", http=http)
    proposal = compose_arrangement(request(), composer)
    assert proposal.provenance.model == "mystery:13b"
    assert (proposal.provenance.licence, proposal.provenance.commercialUse) == (
        "unreviewed",
        "not-allowed",
    )


def test_unknown_generators_fail_closed() -> None:
    assert licence_for("someone-elses-composer", None) == ("unreviewed", "not-allowed", ())


def test_the_plan_hash_proves_the_input_and_output_without_storing_them() -> None:
    composer = ProceduralComposer()
    first = compose_arrangement(request(seed=3), composer).provenance.planSha256
    # Same request, same arrangement: the same hash, so it can be checked later.
    assert compose_arrangement(request(seed=3), composer).provenance.planSha256 == first
    # A different brief is a different input, even if the procedural music came out the same.
    assert (
        compose_arrangement(request(seed=3, brief="calm"), composer).provenance.planSha256 != first
    )
