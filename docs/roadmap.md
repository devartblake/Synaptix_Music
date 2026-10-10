# Synaptix Music Roadmap and Current Status

**Revision date:** 2026-10-10

## Executive Summary

Synaptix Music has completed its foundational editor, project, synchronization, generation, and browser-audio milestones, and Stage 12 — Production Audio and Rendering — is complete and accepted (local certification evidence, 2026-09-26). The active program is Stage 13 — Adaptive Game Audio and SynaptixPlay Runtime Integration — alongside the Project Schema v2 plug-in cutover.

Current estimated completion:

- Foundational stages 1–11: complete
- Stage 12: complete. Accepted by the release owner on 2026-09-26 on the basis of the local certification run (`docs/operations/evidence/stage-12-local-2026-09-26-1702/`); a staging run with the same commands is recommended before production but no longer gates Stage 13.
- Stage 13: approximately 90% implementation-complete (2026-10-09). Slice 13.1 (verified publication) has met its exit; the Flutter loader, scheduler, stem/intensity mixer and stingers are implemented and await on-device listening tests; the platform now ingests runtime telemetry with a dashboard and alerts (13.6; thresholds need staging data); the device matrix and soak (13.7) need staging and physical devices.
- Project Schema v2 plug-in cutover: steps A-F done (plug-in projects sync as v2; first-party plug-ins can be frozen, and freezes play in renders and in the browser); retiring v1 writes (G) remains
- Studio instruments: 32 in the catalog, all synthesized by the Rust kernel in both the render worker and the studio preview. Instrument slices 1–3 are done (slice 1 and 2 merged; slice 3 is in review).
- Studio UI v2 (DAW layout): steps 1–8 and 9a merged behind a preview switch (#82–#101), including a phone layout. Notebook, sticky notes and a Settings dialog are in review. Remaining: making the DAW layout the default and removing the classic layout (9b).
- Full planned DAW roadmap: 52-56% complete

The percentages represent planned functional scope. They do not represent production-readiness, security certification, load certification, or legal clearance.

## Completed Capability Groups

### Reproducible platform foundation

- Pinned Node, npm, Python, and Rust toolchains
- Four-lane GitHub Actions validation
- Docker Compose development dependencies
- Package-boundary validation and committed npm lockfile

### Canonical music-project model

- Versioned cross-runtime project schema
- Tracks, MIDI/audio clips, devices, assets, markers, tempo, and time signatures
- JSON Schema and Python/Pydantic parity
- Canonical serialization and SHA-256 checksums

### Command and revision system

- Serializable and editor commands
- Atomic transactions
- Immutable revisions and lineage
- Browser undo/redo with bounded single-flight history
- Command-backed mixer, transport, MIDI, quantization, transpose, duplication, and drum edits

### Browser DAW

- Multi-track arrangement (add instrument tracks from a 32-instrument catalog, each with its own icon and a starter phrase)
- Piano roll with snapping, marquee selection, zoom, velocity, move, resize, and duplication; Drum Kit tracks show drum names
- Device-aware drum step sequencer
- Per-device controls: filter with resonance, ADSR, reverb send, and a collapsible Modulation section (LFO to pitch, cutoff and level; filter envelope)
- DAW layout preview (Studio UI v2): transport bar, searchable instrument browser, bottom dock (piano roll with scale shading, chords, tools and floating menus; device chain with knobs; mixer channel strips), family-coloured timeline with header meters, section markers and a loop brace, an inspector that follows the selection, an adaptive states grid, Generate as a drawer and Export as a dialog, a phone layout, and a Settings dialog
- MIDI scheduling, audition, panic, and authoritative transport position
- Local autosave, persistence recovery, and multi-tab leases

### Procedural generation

- Deterministic Python/FastAPI composer
- Seeded four-track arrangements
- Typed generation contracts
- Proposal-to-command/revision conversion
- Durable generation-job lifecycle with polling, SignalR, replay, and acknowledgements

### AI-assisted composition

- Switchable composers: procedural, Claude (Anthropic API) and a local open-weight model on the GPU, with automatic procedural fallback
- 12 keys x 7 modes, 60-200 BPM, and orchestration across every playable catalog instrument (role defaults unchanged; Riser and Downsweep FX excluded) with per-section layers and mix hints
- Prototype text-to-audio with MusicGen on the local GPU (non-commercial weights; outputs are prototype-only and never published)

### Plug-ins and Project Schema v2

- Project Schema v2 with plug-in devices, state envelopes, automation lanes and freeze evidence; AudioWorklet host and the first-party Reference Drive
- Plug-in projects sync to the platform as v2; renders pin the stored snapshot's checksum; first-party plug-ins can be frozen on the render worker

### Project synchronization

- IndexedDB-first hybrid repository
- Persistent offline upload queue
- Next.js BFF and .NET project synchronization APIs
- Optimistic concurrency, idempotency, conflicts, revision history, archive, and restore

### Production audio and rendering foundation

- Device-specific instrument profiles
- Drum and music buses
- Shared effects return
- Master compression
- Peak/RMS metering and clipping evidence
- Versioned deterministic render manifests and results
- Production graph integrated into the live `BrowserAudioEngine`, with lazy initialization and disposable meter subscriptions
- Reversible command-backed device enablement and numeric device/effect parameters
- Master meter and clipping indicator mounted in the studio header, with a floor-clamped reading that settles to silence instead of drifting
- Canonical filter-frequency, envelope (attack/decay/sustain/release), and reverb-send device parameters with defined ranges, bound to live runtime nodes via a per-instrument reverb send. Oscillator waveform and dedicated bus/master trim controls remain deferred — they are categorical or project-level rather than per-device, and need their own parameter concept
- A tested, in-memory render-job control-plane state machine: idempotent submission, FIFO leasing, heartbeat-extendable worker leases, exponential-backoff retry, dead-lettering, expired-lease reclamation, and a structured event log
- A durable, concurrency-safe PostgreSQL-backed counterpart (`@synaptix/render-worker`) implementing the same control-plane rules with `SELECT ... FOR UPDATE SKIP LOCKED` leasing, verified against a real database including under concurrent access
- A private, server-to-server HTTP API over the render-job store (submit/status/list/cancel/events), and Next.js BFF routes proxying it with end-user authentication
- A deterministic, pure-JS offline WAV renderer sharing canonical device/parameter semantics with the browser preview (per ADR-0003) via `resolveEffectiveInstrumentSettings`: oscillator/ADSR synthesis, a one-pole filter, mute/solo/pan/volume mixing, per-track reverb sends, Freeverb-style stereo processing, master compression, master or dry per-track stem scope, tick-range restriction, peak normalization, clipping detection, and SHA-256-checksummed PCM WAV output — verified byte-identical across repeated renders of the same manifest
- A worker loop (`processNextJob`/`runWorker`) that leases a job, heartbeats through a slow render, executes the offline renderer, and reports the result back through the control plane's retry/dead-letter rules
- Deterministic FFmpeg MP3/OGG derivatives, bounded master previews, and a validated `artifact-manifest.json` binding every delivery object to immutable render evidence
- A production render-worker image with FFmpeg codecs, least-privilege MinIO policy, and a staging certification command that verifies signed delivery, checksums, byte lengths, preview presence, and artifact-manifest evidence

### Adaptive game-audio contracts (Stage 13 groundwork)

- Framework-neutral adaptive package contracts: states, normalized intensity, loop/cue points, transition rules, and immutable linkage to a project revision and checksum
- Deterministic package assembly from certified render-artifact metadata
- State selection, directed transition lookup, and immediate/beat/bar/phrase/cue-point transition planning
- SynaptixPlay platform persistence contracts and authenticated BFF proxy routes for listing, publishing, and reading adaptive package versions and delivery grants

## Active Work

### Stage 12 — Production Audio and Rendering

Implementation is complete. The control plane, deterministic renderer/master effects, worker loop, fail-closed platform loader, master/stem WAV output, deterministic MP3/OGG derivatives, bounded previews, artifact manifests, MinIO storage, signed delivery, production image, storage policy, and certification harness are implemented and tested. Stage 12 closes operationally only after backend PR #525 is deployed, secrets are provisioned by an authorized operator, and the staging certification runbook passes. A local rehearsal of the complete runbook passed on 2026-09-26 (`docs/operations/evidence/stage-12-local-2026-09-26/`); the release owner decides whether to accept it or repeat it in staging. **Stage 12 evidence: Accepted by the release owner on 2026-09-26 on the basis of the local certification run (`docs/operations/evidence/stage-12-local-2026-09-26-1702/`); a staging run with the same commands is recommended before production but no longer gates Stage 13.**

### Studio UI v2 — DAW layout (active)

A DAW-style studio drawing on FL Studio 2026 and Ableton Live 12.4. Plan, mockup and status are in `docs/plans/ui/studio-ui-v2.md`, and the "before" screenshots are in `docs/plans/ui/studio-ui-baseline-2026-10.md`. Steps 1–8 are merged behind Layout → "DAW layout (preview)": the shell, timeline, piano roll, device chain, mixer, browser and inspector, the adaptive states grid, and Generate and Export as a drawer and a dialog. Follow-ups delivered alongside: the project key and renamable note labels as project data, project origin badges on the home page, and floating, movable piano roll menus. Step 9a, a phone layout for the DAW shell, is merged (#101). In review: a project notebook and sticky notes on tracks and the project, with a Settings dialog that turns them on or off. Next is 9b: switching over and removing the classic layout.

### Stage 13 — Adaptive Game Audio and SynaptixPlay Runtime Integration (active)

Contracts, package builder, transition planning, platform/BFF routes, backend retention/revocation, the Flutter loader/offline cache, the runtime clock and scheduler, stem/intensity mixing, and stingers/ducking are implemented. The remaining work is telemetry dashboards and on-device certification. The per-slice audit is in `stage-13-execution-plan-v1.md`. Package publication remains disabled until Stage 12 staging evidence is accepted.

## Remaining Ordered Work

### 1. Complete production preview integration — done

- ~~Mount the studio master meter~~ Done, with a silence floor fix so it settles instead of drifting.
- ~~Bind filter, envelope, and send controls~~ Done. Oscillator waveform and bus/master trim are intentionally deferred (categorical/project-level, not per-device).
- ~~Define parameter ranges and canonical IDs~~ Done via a shared device-parameter catalog.
- ~~Add meter and runtime-parameter regression tests~~ Done.

### 2. Durable render-job control plane — done

- ~~Render-job API contracts~~ Done (`RenderJobSchema`, `RenderJobEventSchema`).
- ~~Idempotent submission~~ Done (idempotency-key-keyed, conflict-checked against the render ID).
- ~~Queue state machine~~ Done (`RenderJobQueue`: submit, lease, heartbeat, report result, cancel).
- ~~Cancellation and timeouts~~ Done (explicit cancel; lease-expiry timeout).
- ~~Worker leases and heartbeat recovery~~ Done (`lease`/`heartbeat`/`reclaimExpiredLeases`).
- ~~Retry and dead-letter handling~~ Done (exponential backoff, max-attempts dead-lettering).
- ~~Structured render evidence and observability~~ Done (`RenderResult` linkage, append-only event log).
- ~~PostgreSQL persistence~~ Done: `PostgresRenderJobStore` in the new `@synaptix/render-worker` service uses `SELECT ... FOR UPDATE SKIP LOCKED` for safe concurrent leasing across worker processes, and shares `resolveFailureOutcome` with the in-memory queue so retry/dead-letter rules cannot drift between the two. Verified with 14 integration tests against a real Postgres instance, including a concurrent-leasing test proving no job is double-claimed. CI now runs these against a Postgres service container instead of skipping them.
- ~~HTTP submission/status API~~ Done: a private, server-to-server HTTP API (submit/status/list/cancel/events) over the store, deliberately not internet-facing (matching the Python generation-api's "private server-to-server dependency" posture).
- ~~BFF wiring~~ Done: Next.js routes at `/api/platform/render-jobs/*` proxy directly to the render-worker HTTP API, requiring end-user authentication. This is a deliberate deviation from the generation-jobs/adaptive-packages convention of routing everything through the .NET SynaptixPlay backend — implementing that convention here would mean extending a separate, large, unfamiliar production backend (which also hosts KMS, Wallet, and Compliance) for a resource that doesn't yet need its multi-tenant authorization model.
- ~~Per-player render jobs~~ Done (2026-09-27): the BFF asks the platform who the session belongs to (`GET /api/v1/users/me`, cached a minute per token) and sends `x-synaptix-owner`; the worker stores the owner (migration 0003) and scopes list, status, events, cancel, delivery and idempotency to it. Private callers without the header, such as certification tooling, stay unscoped.

### 3. Deterministic offline rendering — done in code

- ~~Reconstruct device and bus topology~~ Done via `resolveEffectiveInstrumentSettings`, the same canonical parameter resolution the browser preview uses (ADR-0003).
- ~~Render an exact tick range plus effect tail~~ Done (`RenderRangeSchema` + `includeTailSeconds`).
- ~~Produce PCM WAV first~~ Done: a from-scratch oscillator/ADSR/one-pole-filter synthesis engine and RIFF/WAVE PCM encoder (16/24/32-bit), independent of Tone.js/Web Audio.
- ~~Record artifact checksum, byte length, sample rate, bit depth, and duration~~ Done.
- ~~Add repeatability certification across identical manifests~~ Done — verified byte-identical output across repeated renders in tests.
- ~~An actual render worker that executes rendering~~ Done: `processNextJob`/`runWorker` lease a job, heartbeat through the render, execute the renderer, and report the result through the control plane.
- ~~Load an exact project revision~~ Done in code: `HttpProjectLoader` calls the fail-closed internal platform endpoint with `X-Service-Token`, validates the canonical schema and requested identifiers, and is wired into the production worker. Backend PR #525 and staging secret provisioning must land before end-to-end certification.
- ~~Model reverb send and master compression~~ Done: deterministic Freeverb-style stereo processing and browser-aligned stereo-linked compression are applied to master renders. Stem renders intentionally remain dry.
- ~~MinIO-backed artifact storage and signed delivery~~ Done behind fail-closed environment configuration.

### 4. Stems and previews — done for Stage 12 scope

- ~~Track stems~~ Done; dry per-track stems are supported. Dedicated bus stems remain a later routing enhancement.
- ~~Master preview files~~ Done; bounded MP3/OGG previews are requestable through the render manifest.
- ~~Naming and artifact manifests~~ Done; every packaged result emits validated `artifact-manifest.json` evidence.
- ~~Download and signed-delivery boundaries~~ Done through recorded-artifact authorization and bounded MinIO grants.
- Export authorization and retention policy continue in Stage 13 package publication hardening.

### 5. Lossy and adaptive exports

- ~~MP3 and OGG conversion after WAV certification~~ Done with FFmpeg; MP3 metadata and Ogg stream identity are canonicalized for repeatable bytes.
- ~~Loop metadata and cue points~~ Done (Stage 13)
- ~~Adaptive state packages~~ Done (Stage 13)
- ~~Flutter/SynaptixPlay consumption contracts~~ Done (Stage 13)
- ~~Game-runtime transition and intensity metadata~~ Done (Stage 13)

Adaptive package contracts, deterministic package assembly, transition planning, and SynaptixPlay platform/BFF routes are implemented as Stage 13 groundwork. Stage 12 evidence is accepted, and publication is verified against the render worker's records (Stage 13.1). The remaining sequence is defined in the Stage 13 execution plan.

### 6. Asset and licensing system

- Audio/soundfont/impulse-response ingestion
- SHA-256 verification
- Provenance and license records
- Missing-asset handling
- Retention and deletion rules

### 7. Operational hardening

Started 2026-10-09: each player may have at most `RENDER_MAX_ACTIVE_JOBS_PER_OWNER` (default 10) queued-or-running render jobs; more answer 429 `render_quota_exceeded`.

- Render telemetry and dashboards
- Capacity and cost limits
- Abuse controls and quotas
- Backup and recovery procedures
- Security review
- Cross-browser and multi-device testing

### 8. Profile-driven Rust/WASM work

Rust/WASM remains deferred until profiling demonstrates a material bottleneck in resampling, stretching, pitch shifting, filtering, encoding preparation, or other DSP kernels.

Profiled 2026-10-09 (`docs/development/dsp-profiling.md`): no such bottleneck. Synthesis dominates render time; the next steps, if renders need to be faster, are TypeScript-level synthesis changes before any WASM kernel.

The instruments a Rust synthesis kernel would enable, and the decided first slice (PolyBLEP oscillators, supersaw, Karplus–Strong pluck, 2-operator FM), are in `docs/plans/implementation/instrument-catalog-roadmap-v1.md`.

Started 2026-10-09: the render worker and the studio preview (AudioWorklet) now synthesize instrument notes with the same Rust kernel (`crates/dsp` → `packages/dsp-kernel`), with band-limited saw and square waves.

Kernel status, 2026-10-10 (noise, the FM mallet presets, the 12.5% pulse and the chip triangle are in review, #75–#77):

- **Oscillators:** PolyBLEP saw, square and 25%/12.5% pulses; supersaw; Karplus–Strong; four 2-operator FM presets; Drum Kit; 808; noise; and a stepped chip triangle.
- **Shaping:** a resonant filter, an LFO and filter-envelope modulation, and a stereo voice path.
- **Engine version:** the render worker stamps its engine version (`RENDER_ENGINE_VERSION` 1.2.0).
- **Tests:** golden checksums pin every catalog instrument's output.

## Deferred or Later-Phase Work

- Third-party plugin hosting
- Desktop-native packaging
- Real-time multiplayer collaboration
- General-purpose multitrack audio recording
- Full waveform editing
- Marketplace distribution
- Unbounded AI model hosting

## Release Gates

The first tagged alpha should require:

- clean checkout and local startup documentation;
- stable canonical schema and migrations;
- browser editor recovery tests;
- platform synchronization convergence tests;
- production graph and meter validation;
- one deterministic offline WAV path;
- artifact checksum evidence;
- current changelog, ADRs, runbooks, and release notes.
