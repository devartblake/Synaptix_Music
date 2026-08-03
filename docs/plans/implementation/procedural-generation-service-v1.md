# Stage 6 — Procedural Generation Service v1

## Goal

Provide a deterministic server-side composition service that creates an editable arrangement proposal for the canonical Synaptix Music project model.

The first generator deliberately targets one constrained style: **electronic trivia/game-show music**. It does not render audio, mutate a stored project, reserve credits, or run a machine-learning model.

## Runtime boundary

```text
Client or SynaptixPlay API
        ↓ validated request
Python FastAPI generation service
        ↓ deterministic proposal
TypeScript client validates proposal
        ↓ future command translation
Command transaction system
        ↓
Canonical project revision
```

The generator returns structured music data. The browser will later translate accepted proposals into project commands so the user can undo, redo, compare, or reject generated material.

## Inputs

- Project ID
- Genre: `electronic-trivia`
- Mood: upbeat, tense, or triumphant
- Tempo: 90–140 BPM
- Minor key
- Duration: 8–64 bars
- Energy: 0–1
- Complexity: 0–1
- Explicit integer seed

## Output

- Section plan: intro, main loop, tension, victory
- Four generated tracks: drums, bass, harmony, melody
- Instrument identifiers
- MIDI clips and notes
- Generator ID, version, and seed
- Warnings collection

## Determinism

The composer uses a request-scoped `random.Random(seed)` instance. It does not read process-global random state, current time, operating-system entropy, or external services.

Given the same request and generator version, the serialized proposal must be identical.

## Musical rules

- 960 ticks per quarter note
- 4/4 meter for the first implementation
- Minor-scale pitch constraints
- Four-chord functional loop
- Kick/snare/hat drum template with energy-controlled density
- Root-driven bass pattern
- Triadic harmony
- Seeded stepwise melody with complexity-controlled subdivision

## Contracts

Equivalent request and response contracts live in:

- `services/generation-api/app/models/generation.py`
- `packages/generator-contracts/src/index.ts`

The Python API is authoritative for generation execution. TypeScript validates the response before later conversion into command transactions.

## Endpoint

```http
POST /generation/projects
```

The endpoint currently executes synchronously because generation is inexpensive and bounded. A later job boundary can preserve the same request and proposal contracts when model inference or heavier generation is introduced.

## Acceptance criteria

- Identical input and seed produce identical output.
- Different seeds alter generated musical content.
- Output contains four populated MIDI tracks.
- Section durations equal the requested arrangement duration.
- MIDI pitch, velocity, timing, and identifiers validate.
- Unsupported tempos and unsupported styles are rejected.
- Python Ruff, formatting, and tests pass.
- TypeScript contracts type-check under the monorepo CI gate.

## Deferred

- Additional genres and meters
- Chord and section regeneration endpoints
- Converting proposals into serialized editor commands
- Redis-backed asynchronous jobs
- Generation credit reservation
- User instrument packs
- Model inference
- Audio rendering
- Similarity and copyright-risk analysis
