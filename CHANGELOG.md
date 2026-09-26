# Changelog

## Unreleased

### Added

- Added switchable arrangement composers to the generation API (`SYNAPTIX_COMPOSER=procedural|claude|local`). The Claude composer (default model `claude-opus-5`, structured output, adaptive thinking, server-side refusal fallbacks) writes a compact arrangement plan: per-section chords, 16-step drum and bass patterns, and melody phrases in scale degrees. The service renders it into in-key, in-bounds notes. The studio now sends the creative brief, and previews name the composer. Any AI failure falls back to the procedural composer with a plain-language warning. The backend dispatch timeout is configurable (`Music:DispatchTimeoutSeconds`, default 180 s).
- Added a piano-roll velocity lane: drag a note's bar (or the whole selection) or use arrow keys, with each change a single undo step.
- Added browser storage monitoring (usage on the home page, warnings when storage is nearly full, and plain-language errors when a save fails for lack of space) and a crash-recovery journal that offers unsaved edits back after a crash or closed tab.
- Added note copy, cut and paste in the piano roll (Ctrl/Cmd+C, X, V and toolbar buttons). Pasted notes land after the selection or at the playhead, as one undoable step, and can move between clips. Added **Stop sound** (panic) to the piano roll and drum sequencer, which also silences note previews.
- Added project export and import: each home project card exports a `.synaptix.json` file with a checksum, and **Find or create project → Import** opens a file as a new copy, refusing edited, damaged or unsupported files with an explanation.
- Added studio save safety: a Saved / Saving / Not saved indicator, a failed-save banner with **Retry save** that re-saves the same revision without replaying the edit, a leave-page warning while changes are unsaved, and single-writer tabs (a second tab on the same project is read-only until the first closes). Cloud uploads now name the last revision that actually saved as their parent.
- Added package developer guides (command-system, project-storage, daw-engine, render-contracts), sequence diagrams for sync, generation and render flows (`docs/architecture/flows.md`), and `CONTRIBUTING.md` requiring docs and changelog updates with each change.
- Added Stage 13 publication hardening: player-readable active versions, pending→active activation on finalization, superseded/revoked/expired retention, retention-checked delivery grants and downloads, owner revocation with automatic rollback, manifest-to-request evidence validation, and idempotency-conflict detection. Studio version history shows retention and offers revoke.
- Added the Flutter adaptive runtime slices: streamed checksum verification, age-limited cache, last-verified offline fallback with revocation purge, monotonic transport clock with boundary preload/cancellation/drift correction, voice-group-aligned stems with intensity gains and master fallback, tag-resolved states, stingers with bounded ducking and cooldowns, redacted telemetry forwarding, and a server kill switch/stems flag.
- Added an optional `clock` (tempo, meter, phrase length) to the adaptive manifest contract, taken from the project tempo map and used by game runtimes for beat/bar/phrase quantization; added reconnect-time package refresh that stops withdrawn packages and stages newer versions for the next load.
- Added adaptive playback underrun telemetry (stalls and lost voices, measured against the lifecycle-aware transport clock) and a studio Role control that authors stinger states for the seven gameplay cues, keeping them out of the default state and transition graph.
- Added the Stage 13 certification and rollout runbook (device matrix, functional checks, staged rollout, kill switch and rollback) and an admin Adaptive Audio diagnostics screen with live mixing, timing and health data plus an on-device 30-minute soak harness that reports pass/fail JSON evidence.
- Added the first Stage 13 Adaptive States authoring workspace with completed-render discovery, state/intensity controls, validated manifest preview, and an explicit fail-closed Stage 12 publication gate.
- Added the first studio UI modernization slice: a responsive, timeline-first three-panel shell, semantic dark-theme tokens, project synchronization and revision status, and restrained SynaptixPlay adaptive-audio accents.
- Added visible, explicitly gated entry points for generation, adaptive-state authoring, and publication workflows without presenting unfinished actions as functional.
- Added a production-connected generation workspace with creative-brief interpretation, presets, structured controls, idempotent generation-job submission, durable polling/reload recovery, proposal preview, duplicate-application protection, and reversible apply-to-project behavior.
- Added credentialed SignalR generation updates with immediate/reconnect reconciliation and polling fallback, plus desktop/tablet layout contracts and axe-powered WCAG screen-reader validation in CI.
- Added Project Schema v2 cutover prerequisites: renders pin the checksum of the snapshot the platform stored (v1 or v2) and explain up front when plug-ins would stop a render; the SynaptixPlay backend rejects uploads with an unknown project schema version or mismatched project, revision or checksum; and revisions that could not upload earlier (such as plug-in projects before the platform accepts v2) upload on project load or **Sync now**, surfacing a conflict instead of overwriting a diverged cloud copy.
- Added the local composer (`SYNAPTIX_COMPOSER=local`): an open-weight model (default `qwen2.5:7b`) in an optional Ollama GPU container (`COMPOSE_PROFILES=local-ai`) writes the same arrangement plan as the Claude composer, constrained by a tightened schema grammar so it always produces full drum, bass, harmony and melody parts. Includes a model comparison script.
- Added SynaptixPlay sign-in to the studio (home page and studio header). The platform access token lives in an HttpOnly cookie held by the studio's server, which now sends it as the `Authorization` header on every `/api/platform/*` call instead of forwarding browser cookies. The render-job and adaptive proxies now require a valid, unexpired session rather than any cookie. Live generation updates use a same-origin token endpoint, and cloud lists and pending uploads retry after sign-in. Sessions last as long as the platform's access token (8 minutes by default), and the studio says when to sign in again; silent refresh needs a platform decision, because `/auth/refresh` requires the KMS secure channel.
- Added `npm run publish:cert-revision`, which publishes a fixed certification project through the studio's own routes and prints the `STAGE12_CERT_*` inputs, and recorded a full local Stage 12 certification rehearsal (all formats, determinism, and every negative path) in `docs/operations/evidence/stage-12-local-2026-09-26/`.

### Fixed

- Fixed the render-worker MinIO policy, which MinIO rejected (`s3:GetBucketLocation` can't take an `s3:prefix` condition), and made the local stack give the worker the scoped `RENDER_WORKER_MINIO_*` service account instead of the MinIO root credentials.
- Fixed regressions from merging Project Schema v2 (#41, #43) with the studio workflow work: the studio compiles again; crash recovery, project export/import and new-project saves handle plug-in (schema v2) projects; cloud uploads again use the last revision that actually saved as their parent; per-track reverb sends and the project mixer survive v2 conversion (Zod, JSON Schema and Python contracts updated); and frequency-drone tracks follow their chosen output bus again.
- Fixed the render-worker image installing with npm 10 (the base image default) instead of the repository's required npm 11.4.2, which printed `EBADENGINE` warnings during `run-local.sh`.
- Fixed the local-development guide and environment templates: the SynaptixPlay backend runs on port 5100 (not 5080), must listen on all interfaces for Docker, and needs a matching render-worker service token; the SignalR URL includes `/ws/notify`.
- Fixed adaptive package integration defects: version responses now include artifact descriptors, the Flutter parser reads the canonical `masterArtifactId`/`stemArtifactIds` manifest, the mobile app now bootstraps the adaptive runtime, and studio contracts accept the platform's `Accepted`-style enum casing.

All notable Synaptix Music changes are documented here. The project is pre-release, so entries are grouped under `Unreleased` and reference the pull request or milestone that introduced each completed slice.

## [Unreleased]

### Added

#### Stage 12 preview, artifact-manifest, and lossy export completion

- Added deterministic FFmpeg-backed MP3 and OGG delivery packaging after the canonical WAV render, including canonical Ogg serials/page CRCs so retries remain byte-identical.
- Added optional bounded MP3/OGG master previews and configurable lossy bitrates to the render manifest.
- Added a strict artifact-manifest contract and emitted `artifact-manifest.json` linking every audio/preview artifact to its immutable project revision, checksum, engine, range, and scope evidence.
- Added a Node 22 production render-worker image containing FFmpeg with MP3/Vorbis codecs.
- Added a least-privilege MinIO policy restricted to `synaptix-assets/renders/*`.
- Added `npm run certify:stage12` and an operations runbook to submit a real staging render, verify signed downloads/checksums/byte lengths, and retain certification evidence.
- Added the ordered Stage 13 execution plan covering publication hardening, Flutter loader/cache, runtime scheduling, stem mixing, stingers/ducking, telemetry, and cross-device rollout.

#### Stage 12 platform project loader and production worker wiring

- Added a fail-closed `HttpProjectLoader` that fetches an exact immutable project revision from the SynaptixPlay backend's internal music API, sends `X-Service-Token`, validates the response with `MusicProjectSchema`, and rejects identifier mismatches.
- Wired the render polling loop into `main.ts` when both platform-loader and MinIO configuration are present, including stable worker IDs and graceful abort on shutdown.
- Added focused coverage for successful loads, service-token forwarding, HTTP failures, schema drift, identifier mismatches, and environment configuration.
- Added the matching fail-closed internal revision API in SynaptixPlay backend PR #525; staging still needs matching `RENDER_WORKER_SERVICE_TOKEN` / `ServiceTokens__RenderWorker` secret provisioning and end-to-end verification.

#### Stage 12 MinIO artifact storage and signed delivery

- Added `MinioArtifactStore` as a durable `ArtifactSink` using deterministic `renders/{renderId}/{fileName}` object keys and checksum/artifact metadata.
- Added bounded presigned GET delivery and a render-worker route that only signs artifacts recorded on a completed render job.
- Added an authenticated Next.js BFF proxy route for artifact download grants.
- Added opt-in environment configuration and automated coverage for upload naming, metadata, expiry limits, path traversal, and recorded-artifact authorization.
- Production least-privilege MinIO credential provisioning and deployment verification remain operational work.

#### Stage 12 deterministic offline reverb and master compression

- Added deterministic Freeverb-style stereo reverb with canonical per-track `reverbSend` routing in the offline master renderer.
- Added a stereo-linked feed-forward master compressor aligned with the browser graph's fixed threshold, ratio, attack, and release settings.
- Preserved dry stem exports for remixing and adaptive layer assembly.
- Added DSP and renderer regression coverage for repeatability, decay, gain reduction, stereo linking, reverb-send binding, and dry-stem isolation.

#### Stage 12 render-job HTTP API, BFF wiring, and offline WAV rendering — commits c3ffdc9, 513b7b9

- Added a private, server-to-server render-job HTTP API (`services/render-worker/src/http-server.ts`): `POST /render-jobs` (idempotent submission), `GET /render-jobs`/`GET /render-jobs/:id` (list/status), `POST /render-jobs/:id/cancel`, `GET /render-jobs/:id/events`. Not internet-facing, matching the Python generation-api's private-dependency posture.
- Added Next.js BFF routes at `/api/platform/render-jobs/*` proxying directly to the render-worker HTTP API via a new `RENDER_WORKER_API_URL` env var, requiring end-user authentication. This deliberately deviates from the generation-jobs/adaptive-packages convention of routing everything through `SYNAPTIX_PLATFORM_API_URL` (the .NET SynaptixPlay backend) — that backend is a separate, large, unfamiliar production solution (also hosting KMS, Wallet, and Compliance) that doesn't need to be extended for a resource that has no multi-tenant authorization requirement yet.
- Added a deterministic, dependency-free offline WAV renderer (`offline-renderer.ts`): reuses `resolveEffectiveInstrumentSettings` from `@synaptix/daw-engine` (via a new Tone.js-free `./production-audio` subpath export) for canonical device/parameter semantics per ADR-0003, then does its own pure-JS oscillator/ADSR/one-pole-filter synthesis, mute/solo/pan/volume mixing, master-or-stems scope handling, tick-range restriction, peak normalization, and clipping detection. Deterministic reverb and master compression were added in the subsequent DSP slice above.
- Added a RIFF/WAVE PCM `wav-encoder.ts` (16/24/32-bit) and SHA-256 artifact checksumming.
- Added a worker loop (`worker.ts`): `processNextJob` leases one job, heartbeats for the duration of the render (so a slow render isn't reclaimed by another worker), executes the renderer, and reports the result through the control plane's existing retry/dead-letter rules; `runWorker` polls it continuously. Production `ProjectLoader` and `ArtifactSink` implementations were added in subsequent slices above.
- Added `FilesystemArtifactSink`, a local-disk placeholder for artifact storage pending real object-storage upload and signed delivery.
- Added a minimal `main.ts` entry point that boots the HTTP API; production worker-loop wiring was added in the platform project-loader slice above.
- Added 24 new tests (42 total in the package): full HTTP lifecycle tests against a real running server, 11 offline-renderer tests (determinism, silence gating, mute/solo, range filtering, stems, normalization, fail-closed error handling), 5 WAV-encoder tests, and 5 worker-loop tests including a heartbeat-during-slow-render race test — all verified against a real, disposable Postgres instance.
- Fixed a test-isolation bug: Node's test runner executes test **files** concurrently by default, so two files sharing one database and each truncating its tables in `beforeEach` were racing each other. Added `--test-concurrency=1` to the package's test script.
- **Remaining operational gap:** merge and deploy the matching SynaptixPlay backend endpoint, provision matching service and object-storage credentials, and run an end-to-end staging render.

#### Stage 12 render-job PostgreSQL persistence — commit c3b3d98

- Added the `@synaptix/render-worker` service (`services/render-worker`) with `PostgresRenderJobStore`, a durable, concurrency-safe counterpart to the in-memory `RenderJobQueue`.
- Leasing uses `SELECT ... FOR UPDATE SKIP LOCKED` so multiple worker processes can lease concurrently without double-claiming a job; verified with a dedicated concurrent-leasing test against a real database.
- Extracted `resolveFailureOutcome`, the retry/dead-letter decision logic, into a pure function shared by both `RenderJobQueue` and `PostgresRenderJobStore` so the two implementations cannot silently diverge on business rules.
- Added a SQL migration (`db/migrations/0001_render_jobs.sql`) for `render_jobs` and `render_job_events`, applied idempotently via `applyMigrations()`.
- Added 14 integration tests, gracefully skipped when no database is configured and run for real via `RENDER_WORKER_TEST_DATABASE_URL`. Wired a Postgres service container into the CI TypeScript job so these run for real instead of always skipping, and added `services/render-worker/` to the CI TypeScript path-detection pattern.
- An HTTP submission/status API, BFF wiring, and an actual render worker that executes rendering are not yet implemented.

#### Stage 12 render-job control plane contracts — commit 25f4c94

- Added `RenderJob` and `RenderJobEvent` contracts (status lifecycle, lease fields, retry/dead-letter fields, structured events) alongside the existing render manifest/result contracts.
- Added `RenderJobQueue`, a tested in-memory state machine: idempotent submission keyed by idempotency key with render-ID conflict detection, FIFO leasing that respects scheduled retry times, heartbeat-extendable worker leases, exponential-backoff retry up to a configurable attempt limit, dead-lettering, expired-lease reclamation, and an append-only event log for observability.
- Extracted the existing render manifest/result schemas out of `render-contracts`'s barrel file into their own module so the new job contracts can depend on them without a circular import.
- Added 28 deterministic tests across the render-contracts package (17 new) covering the full job lifecycle, retry backoff, ownership/authorization failures, and lease expiry.
- This slice was contracts and in-process queueing logic only, matching how Stage 12's foundation and Stage 13's groundwork were bootstrapped; PostgreSQL persistence followed immediately after (see below).

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

Stage 12 (Production Audio and Rendering) is implementation-complete: durable jobs, exact-revision loading, deterministic WAV rendering with master effects, stems, MP3/OGG derivatives, bounded previews, artifact manifests, MinIO signed delivery, production image/policy, and certification tooling are implemented and tested. Live secret provisioning and staging evidence remain before operational closure. Stage 13 execution is now ordered across publication hardening, Flutter loading/cache, playback scheduling, stem mixing, stingers/ducking, telemetry, and cross-device certification; publication remains gated on accepted Stage 12 evidence.

## Release Policy

The first tagged alpha requires the standalone browser editor, local persistence, procedural generation, platform job integration, project synchronization, production audio graph, and at least one deterministic offline WAV rendering path to be validated together.
