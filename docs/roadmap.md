# Synaptix Music Roadmap and Current Status

**Revision date:** 2026-08-15

## Executive Summary

Synaptix Music has completed its foundational editor, project, synchronization, generation, and browser-audio milestones. The active program is Stage 12 — Production Audio and Rendering. Stage 13 — Adaptive Game Audio and SynaptixPlay Runtime Integration — has also started in parallel: its contract, package-builder, transition-planning, and platform/BFF layers are implemented ahead of the Stage 12 render pipeline they ultimately depend on.

Current estimated completion:

- Foundational stages 1–11: complete
- Stage 12: 85% complete; production-graph integration, master-meter mounting, canonical device-parameter binding, durable render-job persistence, an HTTP submission/status API, BFF wiring, a deterministic offline WAV renderer, and a worker loop tying leasing to rendering are all done and tested. What remains: a real project loader wired to the platform backend (blocked on a service-to-service auth decision), real artifact storage/signed delivery (currently a local-filesystem placeholder), reverb/compression modeling in the offline renderer (currently dry-signal only), and stems/lossy exports
- Stage 13: early groundwork only (contracts, package builder, transition planning, and platform persistence/BFF routes); publication is blocked until Stage 12 produces certified render artifacts
- Full planned DAW roadmap: 48–52% complete

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

- Four-track arrangement
- Piano roll with snapping, marquee selection, zoom, velocity, move, resize, and duplication
- Device-aware drum step sequencer
- MIDI scheduling, audition, panic, and authoritative transport position
- Local autosave, persistence recovery, and multi-tab leases

### Procedural generation

- Deterministic Python/FastAPI composer
- Seeded four-track arrangements
- Typed generation contracts
- Proposal-to-command/revision conversion
- Durable generation-job lifecycle with polling, SignalR, replay, and acknowledgements

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
- A deterministic, pure-JS offline WAV renderer sharing canonical device/parameter semantics with the browser preview (per ADR-0003) via `resolveEffectiveInstrumentSettings`: oscillator/ADSR synthesis, a one-pole filter, mute/solo/pan/volume mixing, master or per-track stem scope, tick-range restriction, peak normalization, clipping detection, and SHA-256-checksummed PCM WAV output — verified byte-identical across repeated renders of the same manifest
- A worker loop (`processNextJob`/`runWorker`) that leases a job, heartbeats through a slow render, executes the offline renderer, and reports the result back through the control plane's retry/dead-letter rules

### Adaptive game-audio contracts (Stage 13 groundwork)

- Framework-neutral adaptive package contracts: states, normalized intensity, loop/cue points, transition rules, and immutable linkage to a project revision and checksum
- Deterministic package assembly from certified render-artifact metadata
- State selection, directed transition lookup, and immediate/beat/bar/phrase/cue-point transition planning
- SynaptixPlay platform persistence contracts and authenticated BFF proxy routes for listing, publishing, and reading adaptive package versions and delivery grants

## Active Work

### Stage 12 — Production Audio and Rendering

Current active slice: closing out the render pipeline. The render-job control plane (contracts, in-memory and PostgreSQL-backed stores, HTTP API, BFF wiring), the deterministic offline WAV renderer, and the worker loop are all implemented and tested. Two gaps block genuine end-to-end use from the browser: (1) the worker has no real `ProjectLoader` — fetching an exact project revision from the platform backend needs a service-to-service authentication strategy that hasn't been decided (background workers don't have an end user's session), and (2) rendered artifacts are written to local disk as a placeholder rather than uploaded to real object storage with signed delivery.

### Stage 13 — Adaptive Game Audio and SynaptixPlay Runtime Integration (started in parallel)

Contract, package-builder, transition-planning, and platform/BFF work is implemented. This slice does not yet decode or play audio, and packages cannot be published until Stage 12 produces certified render artifacts. Remaining work: package authorization/versioning/retention/signed delivery, the Flutter runtime loader and cache, beat/bar/phrase playback scheduling, layered stem mixing, stingers/ducking, telemetry, and cross-device certification.

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

### 3. Deterministic offline WAV rendering — mostly done

- ~~Reconstruct device and bus topology~~ Done via `resolveEffectiveInstrumentSettings`, the same canonical parameter resolution the browser preview uses (ADR-0003).
- ~~Render an exact tick range plus effect tail~~ Done (`RenderRangeSchema` + `includeTailSeconds`).
- ~~Produce PCM WAV first~~ Done: a from-scratch oscillator/ADSR/one-pole-filter synthesis engine and RIFF/WAVE PCM encoder (16/24/32-bit), independent of Tone.js/Web Audio.
- ~~Record artifact checksum, byte length, sample rate, bit depth, and duration~~ Done.
- ~~Add repeatability certification across identical manifests~~ Done — verified byte-identical output across repeated renders in tests.
- ~~An actual render worker that executes rendering~~ Done: `processNextJob`/`runWorker` lease a job, heartbeat through the render, execute the renderer, and report the result through the control plane.
- Load an exact project revision — **not done**. The worker takes an injected `ProjectLoader`; no implementation fetches a real revision from the platform backend yet (see the service-to-service auth gap above). Verified so far only via fixture-backed loaders in tests.
- Reverb send and master compression are not modeled — the renderer produces the dry signal only. Documented simplification, not an oversight; ADR-0003 only requires the *preview and worker to share device/routing semantics*, not identical DSP implementations.
- Artifact storage is a local-filesystem placeholder (`FilesystemArtifactSink`), not real object storage with signed delivery — that's item 4 below.

### 4. Stems and previews

- Track and bus stems
- Master preview files
- Naming and artifact manifests
- Export authorization and retention
- Download and signed-delivery boundaries

### 5. Lossy and adaptive exports

- MP3 and OGG conversion after WAV certification
- Loop metadata and cue points
- Adaptive state packages
- Flutter/SynaptixPlay consumption contracts
- Game-runtime transition and intensity metadata

Adaptive package contracts, deterministic package assembly, transition planning, and SynaptixPlay platform/BFF routes are already implemented as Stage 13 groundwork; publication is blocked on certified Stage 12 render artifacts (items 2–3 above). Remaining Stage 13 scope: authorization/versioning/retention/signed delivery, the Flutter runtime loader, playback scheduling, stem mixing, stingers, and telemetry.

### 6. Asset and licensing system

- Audio/soundfont/impulse-response ingestion
- SHA-256 verification
- Provenance and license records
- Missing-asset handling
- Retention and deletion rules

### 7. Operational hardening

- Render telemetry and dashboards
- Capacity and cost limits
- Abuse controls and quotas
- Backup and recovery procedures
- Security review
- Cross-browser and multi-device testing

### 8. Profile-driven Rust/WASM work

Rust/WASM remains deferred until profiling demonstrates a material bottleneck in resampling, stretching, pitch shifting, filtering, encoding preparation, or other DSP kernels.

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
