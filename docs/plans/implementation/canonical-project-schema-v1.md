# Canonical Project Schema v1

**Status (2026-09-27):** Complete for v1; superseded for plug-in projects by Project Schema v2 (`project-schema-v2-cutover.md`). From the deferred list, plug-in state blobs and automation lanes now exist in v2, and per-track sends, output buses and a project mixer were added to v1. A project key (`key: { tonic: 0–11, mode }`, optional and absent when unset so existing checksums don't change) was added to v1 and v2 on 2026-10-10; applying a generated arrangement sets it. MIDI notes got an optional `label` (1–32 characters, absent when unset, so checksums don't change) the same day, for renamable note labels in the piano roll. Still deferred: warp markers/time-stretch, collaboration metadata, video sync, notation.

## Goal

Establish one versioned, transport-neutral music-project contract shared by the browser DAW, Python generation service, future render workers, Rust/WASM components, and SynaptixPlay platform APIs.

## Scope

Schema v1 defines:

- Stable project and revision identity
- Project metadata and parent revision lineage
- Musical positions expressed as bar, beat, and tick
- Configurable ticks per quarter note
- Tempo and time-signature maps
- Instrument, audio, and bus tracks
- MIDI and audio clips
- MIDI notes, each with an optional label
- Versioned devices and numeric parameters
- External asset references with SHA-256 integrity metadata
- Section and cue markers
- Optional generation provenance

## Design decisions

- Canonical state is independent of React, Next.js, Tone.js, Python implementation classes, and rendering engines.
- Musical positions are canonical; seconds are derived at runtime from tempo maps.
- Large audio data is referenced through assets rather than embedded in project JSON.
- Persistent entities have stable string identifiers.
- Unknown fields are rejected at validation boundaries.
- Project revisions are immutable after submission for rendering or platform persistence.
- `schemaVersion` is fixed to `1`; future breaking changes require an explicit migration path.

## Contract locations

- TypeScript and Zod: `packages/project-model/src/index.ts`
- JSON Schema: `schemas/project/v1.json`
- Canonical fixture: `schemas/project/fixtures/minimal-v1.json`
- Python and Pydantic: `services/generation-api/app/models/project.py`
- Python validation tests: `services/generation-api/tests/test_project_schema.py`

## Acceptance criteria

- TypeScript packages compile against the expanded Zod model.
- The canonical fixture validates through the Python Pydantic model.
- Unknown project fields are rejected.
- Invalid MIDI ranges are rejected.
- Empty projects receive deterministic transport, tempo-map, and time-signature defaults.
- CI remains green for TypeScript, Python, Rust, and Docker Compose.

## Deferred to later versions

- Automation lanes and automation points
- Warp markers and time-stretch metadata
- Collaboration metadata
- Plugin-specific opaque state blobs
- Advanced routing and sends
- Video synchronization
- Musical notation and score layout

These should be introduced through additive v1 extensions where compatible or through a future versioned migration when breaking changes are necessary.
