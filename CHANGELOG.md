# Changelog

All notable Synaptix Music changes are documented here. The project is pre-release, so entries are grouped under `Unreleased` and reference the pull request that introduced each completed slice.

## [Unreleased]

### Added

#### PR #9 — SynaptixPlay platform integration boundary

- Added `@synaptix/platform-contracts` with strict schemas for users, entitlements, project access, credit reservations, generation jobs, and normalized errors.
- Added a typed browser client for generation-job submission.
- Added a Next.js backend-for-frontend route that validates requests and forwards authentication, correlation IDs, and idempotency keys.
- Added server-only SynaptixPlay API configuration.
- Preserved the Python generation service as a private server-to-server dependency.
- Added Stage 9 architecture and integration documentation.

#### PR #8 — MIDI synthesis, clip visualization, and autosave

- Added Tone.js scheduling for canonical MIDI clips and notes.
- Added per-track channels and polyphonic synthesizers.
- Applied volume, pan, mute, and solo state to the audio graph.
- Added visible generated clip regions to the 16-bar arrangement timeline.
- Added command-backed volume and pan edits with revision persistence.
- Added IndexedDB project restore, debounced autosave, and local storage status.

#### PR #7 — Generation conversion and browser transport

- Converted validated generation proposals into one canonical command transaction.
- Added generated tempo, markers, and provenance to the project revision.
- Added project mismatch and non-empty-project safety guards.
- Expanded the browser audio engine with initialize, load, play, pause, stop, seek, loop, snapshot, and dispose operations.
- Added the first four-track browser arrangement shell.

#### PR #6 — Procedural generation service v1

- Added a deterministic Python/FastAPI procedural composer.
- Added strict Pydantic and TypeScript/Zod generation contracts.
- Added seeded electronic trivia/game-show arrangements.
- Added intro, main, tension, and victory sections.
- Added drums, bass, harmony, and melody MIDI tracks.
- Added deterministic, structural, API, and validation tests.

#### PR #5 — Local project storage v1

- Added the `@synaptix/project-storage` package.
- Added IndexedDB and in-memory storage adapters.
- Added latest project and immutable revision snapshots.
- Added project and revision schema validation and SHA-256 integrity checks.
- Added save, load, list, remove, revision listing, and revision restore operations.

#### PR #4 — Command transaction history v1

- Added serializable commands for tracks, mixer values, and clips.
- Added atomic transactions with reverse-order rollback.
- Added snapshot-based undo and redo history.
- Added revision lineage, injected identifiers and timestamps, canonical JSON, and SHA-256 checksums.

#### PR #3 — Canonical Project Schema v1

- Replaced the placeholder project model with a strict versioned Zod contract.
- Added musical positions, transport, tempo and time-signature maps, typed tracks, clips, notes, devices, assets, markers, and generation provenance.
- Added strict JSON Schema Draft 2020-12 and a representative fixture.
- Added equivalent Python/Pydantic contracts and cross-runtime validation tests.

#### PR #2 — Foundation Slice 1

- Pinned Node, npm, Python, and Rust toolchains.
- Added and enforced a committed npm lockfile.
- Added root build, type-check, lint, test, package-boundary, Docker, and CI commands.
- Added Python Ruff/Pytest validation and health/readiness tests.
- Added Rust formatting, Clippy, tests, and WASM target checks.
- Added pinned PostgreSQL and Redis containers with health checks.
- Expanded GitHub Actions into independent TypeScript, Python, Rust, and Docker jobs.

#### PR #1 — Documentation organization

- Expanded the initial repository README.
- Established `docs/plans/` as the canonical plan location.
- Added architecture, implementation, product, research, and archive plan categories.
- Moved the openDAW-informed architecture plan into the architecture plan directory.
- Added the documentation organization and naming guide.

### Changed

- Updated local-development instructions to use the pinned Node/npm/Python/Rust versions.
- Updated documentation to reflect completion of Stages 1 through 8 and the active Stage 9 integration boundary.
- Added a consolidated implementation-stage index.

### Fixed

- Corrected repeated npm workspace lockfile drift when new packages were introduced.
- Upgraded GitHub Actions to Node 24-compatible action versions.
- Disabled or restored npm caching appropriately during lockfile synchronization.
- Corrected Ruff import ordering and formatting failures in Python generation and schema tests.
- Corrected npm workspace dependency declarations that used the unsupported `workspace:*` protocol.
- Corrected TypeScript contract-export mismatches between generator and project models.

## Release Policy

The first tagged release should be created only after the standalone browser editor, local persistence, procedural generation, platform job integration, and deterministic rendering path are validated together.
