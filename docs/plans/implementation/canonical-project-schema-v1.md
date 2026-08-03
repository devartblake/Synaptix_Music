# Canonical Project Schema v1

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
- MIDI notes
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
