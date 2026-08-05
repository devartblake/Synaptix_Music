# Changelog

All notable Synaptix Music changes are documented here. The project is pre-release, so entries are grouped under `Unreleased` and reference the pull request or milestone that introduced each completed slice.

## [Unreleased]

### Added

#### Documentation Synchronization Milestone

- Added a current roadmap with completion estimates, ordered remaining work, and release gates.
- Added the accepted system architecture covering browser, BFF, .NET platform, Python generation, and render-worker boundaries.
- Added architecture decision records for the canonical project model, local-first synchronization, browser-preview/render separation, and canonical device parameters.
- Added Alpha Foundation release notes and tag-readiness requirements.
- Synchronized the root README, documentation index, and implementation-stage ledger with the actual repository state.

#### Stage 12 foundation — PR #25

- Added device-specific instrument profiles for drums, bass, lead, and general polyphonic tracks.
- Added an explicit browser production graph with drum and music buses, a shared reverb return, master compression, and master output metering.
- Added peak/RMS snapshots and clipping evidence.
- Added versioned deterministic render manifests and results.
- Required exact project revision, project checksum, rendering-engine version, deterministic seed, tick range, scope, output format, sample rate, bit depth, and effect-tail settings.
- Added strict render artifact evidence, including SHA-256 checksums and byte lengths.
- Added deterministic tests for routing profiles, metering, render defaults, invalid ranges, and missing artifact evidence.

#### Detailed MIDI editor and drum workflow — PRs #17–#24

- Added command-backed mixer, transport, MIDI-note, quantization, transposition, duplication, and drum-step edits.
- Added bounded browser undo/redo with keyboard shortcuts, single-flight execution, explicit project anchors, and redo invalidation.
- Added piano-roll selection, snapping, note creation, movement, resizing, velocity editing, marquee selection, zoom, and duplication.
- Added a command-backed drum step sequencer with device-aware lane mappings, multi-bar patterns, velocity/accent controls, duplication, clearing, and playback-position feedback.
- Added track-scoped MIDI audition, authoritative transport tick snapshots, and all-notes-off panic handling.
- Added browser-session recovery state for saving, unsaved, and failed revisions.
- Added retry of the same pending revision envelope without replaying the musical command.
- Added before-unload protection and project-scoped multi-tab editing leases.
- Added deterministic command-history, piano-roll, drum-sequencer, persistence-recovery, and multi-tab tests.

#### Platform project synchronization — PRs #14–#16 and backend PRs #500–#501

- Added local-first hybrid project repositories and persistent IndexedDB synchronization queueing.
- Added authenticated project-list, download, creation, revision-upload, revision-history, archive, and restore APIs.
- Added idempotent writes and `If-Match` optimistic concurrency.
- Added explicit conflict envelopes and user-controlled cloud/local resolution.
- Added automatic startup, online, reconnect, periodic, and manual queue draining.

#### Generation-job status updates — PRs #10–#13

- Added polling, terminal-state handling, and authenticated BFF status reads.
- Added player-scoped SignalR lifecycle delivery with automatic reconnect.
- Added durable reconnect reconciliation, event replay cursors, and acknowledgements.
- Added concurrent active-job tracking.
- Added deterministic job-based command, transaction, and revision identifiers.
- Added duplicate completed-proposal protection and transition coalescing.

#### PR #9 — SynaptixPlay platform integration boundary

- Added `@synaptix/platform-contracts` with strict schemas for users, entitlements, project access, credit reservations, generation jobs, and normalized errors.
- Added a typed browser client and authenticated Next.js backend-for-frontend boundary.
- Preserved the Python generation service as a private server-to-server dependency.

#### PR #8 — MIDI synthesis, clip visualization, and autosave

- Added Tone.js scheduling for canonical MIDI clips and notes.
- Added per-track channels and polyphonic synthesizers.
- Applied volume, pan, mute, and solo state to the audio graph.
- Added visible generated clip regions and IndexedDB autosave.

#### PR #7 — Generation conversion and browser transport

- Converted validated generation proposals into one canonical command transaction.
- Added generated tempo, markers, and provenance to the project revision.
- Added the browser audio transport and four-track editor shell.

#### PR #6 — Procedural generation service v1

- Added a deterministic Python/FastAPI procedural composer.
- Added strict Pydantic and TypeScript/Zod generation contracts.
- Added seeded electronic trivia/game-show arrangements with drums, bass, harmony, and melody.

#### PR #5 — Local project storage v1

- Added IndexedDB and in-memory adapters, immutable revision snapshots, validation, checksum verification, and recovery operations.

#### PR #4 — Command transaction history v1

- Added serializable commands, atomic transactions, rollback, undo/redo history, revision lineage, canonical JSON, and SHA-256 checksums.

#### PR #3 — Canonical Project Schema v1

- Added strict versioned TypeScript/Zod, JSON Schema, fixture, and Python/Pydantic project contracts.

#### PR #2 — Foundation Slice 1

- Pinned Node, npm, Python, and Rust toolchains.
- Added the committed npm lockfile and four-lane CI.
- Added Docker health checks, Python validation, Rust/WASM checks, and package-boundary enforcement.

#### PR #1 — Documentation organization

- Established `docs/plans/` and the architecture, implementation, product, research, and archive categories.

### Changed

- Updated the repository entry points to mark Stages 1–11 complete and Stage 12 active.
- Replaced obsolete Stage 9 next-step text with the current production-audio and rendering sequence.
- Clarified that browser Web Audio is a preview runtime and not production-render evidence.
- Added a formal documentation ownership model and ADR process.

### Fixed

- Corrected repeated npm workspace lockfile drift when packages were introduced.
- Upgraded GitHub Actions to Node 24-compatible action versions.
- Corrected Ruff import ordering and formatting failures.
- Corrected unsupported npm `workspace:*` dependency declarations.
- Corrected TypeScript contract exports and `.ts` ESM test resolution.
- Corrected strict-TypeScript meter-value narrowing in the production audio foundation.

## Active Work

PR #26 integrates the production graph into `BrowserAudioEngine`, exposes master meter subscriptions, and adds command-backed device/effect parameter boundaries.

## Release Policy

The first tagged alpha requires the standalone browser editor, local persistence, procedural generation, platform job integration, project synchronization, production audio graph, and at least one deterministic offline WAV rendering path to be validated together.
