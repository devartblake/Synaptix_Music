# Changelog

All notable Synaptix Music changes are documented here. The project is pre-release, so entries are grouped under `Unreleased` and reference the pull request or milestone that introduced each completed slice.

## [Unreleased]

### Added

#### Stage 12 render-job control plane contracts — commit 25f4c94

- Added `RenderJob` and `RenderJobEvent` contracts (status lifecycle, lease fields, retry/dead-letter fields, structured events) alongside the existing render manifest/result contracts.
- Added `RenderJobQueue`, a tested in-memory state machine: idempotent submission keyed by idempotency key with render-ID conflict detection, FIFO leasing that respects scheduled retry times, heartbeat-extendable worker leases, exponential-backoff retry up to a configurable attempt limit, dead-lettering, expired-lease reclamation, and an append-only event log for observability.
- Extracted the existing render manifest/result schemas out of `render-contracts`'s barrel file into their own module so the new job contracts can depend on them without a circular import.
- Added 28 deterministic tests across the render-contracts package (17 new) covering the full job lifecycle, retry backoff, ownership/authorization failures, and lease expiry.
- PostgreSQL persistence, an HTTP submission/status API, and an actual render worker are not yet implemented — this slice is contracts and in-process queueing logic only, matching how Stage 12's foundation and Stage 13's groundwork were bootstrapped.

#### Stage 12 master meter and device parameter binding — commit 15f13a4

- Mounted `MasterMeter` in the studio header, exposing live peak/RMS/clipping state.
- Added a canonical device-parameter catalog (filter frequency, envelope ADSR, reverb send) with defined ranges, clamping, and override resolution shared between profile defaults and live runtime nodes.
- Restructured the reverb bus into a proper per-instrument send (`Tone.Gain` per device) instead of a fixed whole-bus connection, enabling the new reverb-send control.
- Added a per-track device panel in the studio UI (enable toggle, filter, ADSR, and reverb-send sliders) wired through the existing reversible device commands.
- Added `Device`/`DeviceParameter` type exports to `@synaptix/project-model`.
- Oscillator waveform and dedicated bus/master trim controls are intentionally out of scope for this slice: the command system only carries numeric per-device values, and bus/master gain is project-level rather than per-device.

#### CI efficiency phase — PR #33

- Added path-aware Synaptix Music CI validation so unrelated workspaces are not revalidated on every change.
- Added the Synaptix CI operating-model runbook.

#### Stage 13 adaptive game audio — PRs #29–#31

- Added framework-neutral adaptive package contracts covering named music states, normalized intensity, master/stem artifact references, loop boundaries, entry/exit cues, semantic cue points, and immutable linkage to an exact project revision and SHA-256 checksum.
- Added deterministic adaptive package assembly from certified render-artifact metadata, including loop/cue defaults, deduplicated stem identifiers, and sorted semantic tags.
- Added state selection by normalized intensity and required tags, directed transition lookup, and immediate/beat/bar/phrase/cue-point transition planning with minimum source-playback enforcement.
- Added SynaptixPlay platform persistence contracts and authenticated Next.js BFF proxy routes for listing, publishing, and reading adaptive package versions and artifact delivery grants.
- Added deterministic tests for package assembly, selection, lookup, scheduling, and invalid evidence.
- This slice produces validated package metadata and transition timing only; it does not decode or play audio, and packages cannot be published until Stage 12 produces certified render artifacts.

#### Stage 12 production graph integration — PR #26

- Integrated the production audio graph into `BrowserAudioEngine`, preserving transport scheduling and audition while adding device-profile instrument selection, drum/music bus routing, shared reverb and master compression, master peak/RMS snapshots, clipping evidence, and disposable meter subscriptions.
- Added reversible editor commands for enabling/disabling a device and adding/updating numeric device parameters, participating in the existing revision, undo/redo, IndexedDB, and platform-synchronization pipeline.
- Added `MasterMeter`, a browser-facing master level display with peak, RMS, and clipping indication (not yet mounted in the studio shell).

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
- Lazily initialized the browser production audio graph so server-side and pre-interaction construction of `BrowserAudioEngine` no longer touches the Web Audio API (PR #28).
- Clamped piano roll resize gestures to valid note bounds (PR #32).
- Fixed environment-variable loading: shared root `.env.local` values (including `SYNAPTIX_PLATFORM_API_URL`) never reached the Next.js server process because Next only reads `.env*` files from its own app directory, not the monorepo root. Every platform sync attempt failed with `platform_unavailable` and a 502. `next.config.ts` now loads the monorepo-root env files via `@next/env` (commit 3f997aa).
- Replaced raw JSON error envelopes surfaced in the sync status line with the extracted `message` field (commit 3f997aa).
- Fixed the master meter reporting drifting, non-physical dBFS readings (e.g. -1300 dBFS) instead of settling to silence after playback stops, by clamping sub-floor meter readings to -Infinity (commit 15f13a4).
- Aligned the music-studio app's test runner with the rest of the monorepo (`--experimental-transform-types`), fixing a TypeScript parameter-property incompatibility that only surfaced once a test imported `platform-project-repository.ts` (commit 3f997aa).

### Changed

- Refreshed the local-demo starter arrangement's note patterns in `createStarterProject()` (commit 15f13a4).

## Active Work

Stage 12 (Production Audio and Rendering): build PostgreSQL persistence, an HTTP submission/status API, and BFF wiring for the render-job control plane (contracts and the in-memory queue state machine are done), then an actual render worker and deterministic offline WAV rendering. Stage 13 (Adaptive Game Audio): backend authorization/versioning/retention/signed delivery, the Flutter runtime package loader, and beat/bar/phrase playback scheduling remain, blocked on Stage 12 certified render artifacts for publication.

## Release Policy

The first tagged alpha requires the standalone browser editor, local persistence, procedural generation, platform job integration, project synchronization, production audio graph, and at least one deterministic offline WAV rendering path to be validated together.
