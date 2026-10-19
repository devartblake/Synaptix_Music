"""Licence facts for generated music (docs/plans/implementation/publication-rules-v1.md, phase 1).

Every proposal's provenance is filled from this reviewed table, never from what a model says about
itself. A generator or model that isn't listed fails closed: ``unreviewed`` and ``not-allowed``, so
publishing refuses it until someone reviews its licence and adds it here.
"""

from __future__ import annotations

import hashlib
import json

from app.models.generation import GenerationProposal, GenerationRequest

# (licence, commercialUse, credits). Reviewed 2026-10-19; changes need the licence text checked.
_GENERATORS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    # Our own deterministic code: no model, no third-party licence.
    "synaptix-procedural-composer": ("none", "allowed", ()),
    # Claude through a paid API key: output is ours to use under Anthropic's commercial terms.
    "synaptix-claude-composer": ("Anthropic-Commercial-Terms", "allowed", ()),
}

# Open-weight models for the local composer, by exact Ollama tag: licences differ between sizes of
# the same family (e.g. some Qwen2.5 sizes use the Qwen licence), so only reviewed tags are listed.
_LOCAL_MODELS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "qwen2.5:7b": ("Apache-2.0", "allowed", ()),
    "qwen3:8b": ("Apache-2.0", "allowed", ()),
}

_UNREVIEWED = ("unreviewed", "not-allowed", ())


def licence_for(generator_id: str, model: str | None) -> tuple[str, str, tuple[str, ...]]:
    """The reviewed licence, commercial-use verdict and required credits for a generator/model."""
    if generator_id == "synaptix-local-composer":
        return _LOCAL_MODELS.get(model or "", _UNREVIEWED)
    return _GENERATORS.get(generator_id, _UNREVIEWED)


def plan_sha256(request: GenerationRequest, proposal: GenerationProposal) -> str:
    """SHA-256 over the request (prompt included) and the arrangement it produced."""
    material = {
        "request": request.model_dump(mode="json"),
        "sections": [section.model_dump(mode="json") for section in proposal.sections],
        "tracks": [track.model_dump(mode="json") for track in proposal.tracks],
    }
    canonical = json.dumps(material, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def with_licence(request: GenerationRequest, proposal: GenerationProposal) -> GenerationProposal:
    """The proposal with its provenance's licence facts and plan hash filled in."""
    provenance = proposal.provenance
    licence, commercial_use, credits = licence_for(provenance.generatorId, provenance.model)
    provenance = provenance.model_copy(
        update={
            "licence": licence,
            "commercialUse": commercial_use,
            "planSha256": plan_sha256(request, proposal),
            "credits": list(credits),
        }
    )
    return proposal.model_copy(update={"provenance": provenance})
