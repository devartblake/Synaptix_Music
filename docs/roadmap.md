# Synaptix Music Roadmap and Current Status

**Revision date:** 2026-08-05

## Executive Summary

Synaptix Music has completed its foundational editor, project, synchronization, generation, and browser-audio milestones. The active program is Stage 12 — Production Audio and Rendering.

Current estimated completion:

- Foundational stages 1–11: complete
- Stage 12: 55–60% complete after the active production-audio integration slice
- Full planned DAW roadmap: 35–40% complete

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

## Active Work

### Stage 12 — Production Audio and Rendering

Current active slice:

- integrate the production graph into `BrowserAudioEngine`;
- expose master peak/RMS/clipping state in the studio;
- add reversible device enablement and numeric parameter commands;
- map canonical device/effect parameters to live runtime nodes.

## Remaining Ordered Work

### 1. Complete production preview integration

- Mount the studio master meter
- Bind filter, oscillator, envelope, send, bus, and master controls
- Define parameter ranges and canonical IDs
- Add automation-safe parameter semantics
- Add meter and runtime-parameter regression tests

### 2. Durable render-job control plane

- Render-job API contracts
- PostgreSQL persistence
- Idempotent submission
- Queue state machine
- Cancellation and timeouts
- Worker leases and heartbeat recovery
- Retry and dead-letter handling
- Structured render evidence and observability

### 3. Deterministic offline WAV rendering

- Load an exact project revision and verified assets
- Reconstruct device and bus topology
- Render an exact tick range plus effect tail
- Produce PCM WAV first
- Record artifact checksum, byte length, sample rate, bit depth, and duration
- Add repeatability certification across identical manifests

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
