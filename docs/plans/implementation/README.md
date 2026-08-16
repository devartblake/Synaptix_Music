# Implementation Stage Index

This index records completed Synaptix Music implementation slices and the current ordered work.

## Completed Stages

| Stage | Pull request | Result |
|---|---:|---|
| Documentation foundation | #1 | Established the documentation taxonomy and expanded the initial README |
| Foundation Slice 1 | #2 | Pinned toolchains, committed the lockfile, and established four-lane CI |
| Canonical Project Schema v1 | #3 | Added strict TypeScript, JSON Schema, fixture, and Python project contracts |
| Command, Transaction, Undo, and Revision System | #4 | Added serializable commands, atomic transactions, history, revisions, and checksums |
| Local Project Storage | #5 | Added IndexedDB/in-memory persistence, revision storage, and integrity checks |
| Procedural Generation Service | #6 | Added deterministic electronic-trivia MIDI arrangement generation |
| Generation Conversion and Browser Transport | #7 | Converted proposals into one undoable revision and added the transport/editor shell |
| MIDI Synthesis, Clip Visualization, and Autosave | #8 | Added audible scheduling, mixer controls, visible clips, and local autosave |
| SynaptixPlay Platform Integration | #9 | Added typed platform contracts and the authenticated Next.js BFF boundary |
| Generation Job Status Updates | #10–#13 | Added polling, SignalR, reconnect recovery, replay, acknowledgements, coalescing, and idempotent application |
| Platform Project Synchronization | #14–#16 plus backend #500–#501 | Added hybrid repositories, offline queueing, BFF/backend APIs, optimistic concurrency, conflicts, revision history, archive, and restore |
| Editor Commands and Undo/Redo | #17–#18 | Added command-backed mixer and MIDI mutation coverage with reversible batch operations |
| Piano Roll and Drum Workflow | #19–#21 | Added selection, snapping, marquee, zoom, velocity editing, duplication, and drum sequencing |
| Audition, Transport, and History Hardening | #22–#24 | Added audition, panic, authoritative ticks, bounded history, recovery, before-unload protection, and multi-tab leases |
| Stage 12 Foundation — Production Audio and Render Contracts | #25 | Added device profiles, buses, shared effects, master metering, clipping evidence, and deterministic render contracts |
| Stage 12 — Production Graph Integration | #26, #28 | Integrated the production graph into `BrowserAudioEngine` with lazy initialization, master peak/RMS/clipping snapshots, and reversible command-backed device enablement and numeric device/effect parameters |
| Stage 13 — Adaptive Package Contracts and Builder | #29–#31 | Added framework-neutral adaptive package contracts, deterministic package assembly from certified render artifacts, state/transition planning (immediate/beat/bar/phrase/cue-point), and SynaptixPlay platform persistence contracts with authenticated BFF proxy routes |
| Editor hardening | #32 | Clamped piano roll resize gestures to valid note bounds |
| CI efficiency phase | #33 | Added path-aware Synaptix Music validation and the CI operating-model runbook |
| Local development fixes | 3f997aa | Fixed monorepo-root `.env.local` never reaching the Next.js server (root cause of the `platform_unavailable` / 502 sync failures), replaced raw JSON error bodies in the sync status line with extracted messages, and aligned the app's test runner with the rest of the monorepo |
| Stage 12 — Master Meter and Device Parameter Binding | 15f13a4 | Mounted the master meter in the studio header, added a canonical filter/envelope/reverb-send device-parameter catalog with defined ranges bound to live runtime nodes via a per-instrument reverb send, fixed the meter reporting non-physical values instead of settling to silence, and refreshed the local-demo starter patterns |
| Stage 12 — Render-Job Control Plane Contracts | 25f4c94 | Added `RenderJob`/`RenderJobEvent` schemas and a tested, in-memory `RenderJobQueue` state machine: idempotent submission, FIFO leasing, heartbeat-extendable leases, exponential-backoff retry, dead-lettering, expired-lease reclamation, and a structured event log |
| Stage 12 — Render-Job PostgreSQL Persistence | c3b3d98 | Added the `@synaptix/render-worker` service with a concurrency-safe `PostgresRenderJobStore` (`SELECT ... FOR UPDATE SKIP LOCKED` leasing), a migration, and 14 integration tests verified against a real Postgres instance including concurrent leasing; wired a Postgres service container into CI so these run for real instead of skipping |
| Stage 12 — Render-Job HTTP API, BFF Wiring, and Offline WAV Rendering | c3ffdc9, 513b7b9 | Added a private render-job HTTP API and Next.js BFF routes (direct proxy, not through the .NET backend); a deterministic pure-JS offline WAV renderer sharing canonical device/parameter semantics with the browser preview; and a worker loop (`processNextJob`/`runWorker`) tying leasing, heartbeats, rendering, and result reporting together. 42 tests verified against a real Postgres instance, including a full submit-through-completion lifecycle and a heartbeat-during-slow-render test. No real `ProjectLoader` or object-storage upload yet — see Stage 12 exit criteria notes |

## Active Stage

### Stage 12 — Production Audio and Rendering

Production-graph integration, command-backed device/effect controls, master-meter mounting, and canonical device-parameter binding are complete (#26, #28, 15f13a4). The render-job control plane, the deterministic offline WAV renderer, and the worker loop are all implemented and tested. The active slice is closing the two remaining gaps: a real `ProjectLoader` (blocked on a service-to-service authentication decision for the platform backend) and real object-storage upload/signed delivery (currently a local-filesystem placeholder).

### Completed Stage 12 foundation

- Device-specific drum, bass, lead, and polyphonic instrument profiles
- Explicit drum and music buses
- Shared reverb return and master compression
- Peak/RMS metering and clipping evidence
- Versioned deterministic render manifests and results
- Exact project revision, checksum, engine version, seed, range, scope, and output requirements
- Production graph integrated into the live `BrowserAudioEngine`, with reversible device-enable and numeric-parameter commands
- Master meter mounted in the studio header with a floor-clamped, settling display
- Canonical filter-frequency, envelope, and reverb-send device parameters with defined ranges, bound to live runtime nodes
- `RenderJob`/`RenderJobEvent` contracts and a tested in-memory `RenderJobQueue` state machine (submission, leasing, heartbeats, retries, dead-lettering, lease reclamation)
- A concurrency-safe `PostgresRenderJobStore` (`@synaptix/render-worker`) sharing the same retry/dead-letter rules, verified with 14 integration tests against a real database and wired into CI via a Postgres service container
- A private render-job HTTP API (submit/status/list/cancel/events) and Next.js BFF routes at `/api/platform/render-jobs/*` proxying it directly (not through the .NET backend — see the exit-criteria notes)
- A deterministic offline WAV renderer (`renderProjectOffline`) sharing canonical device/parameter semantics with the browser preview, and a worker loop (`processNextJob`/`runWorker`) that leases, heartbeats, renders, and reports results

### Remaining Stage 12 sequence

1. ~~Complete the active `BrowserAudioEngine` production-graph integration.~~ Done (#26, #28).
2. ~~Mount master meters and clipping state in the studio.~~ Done.
3. ~~Map canonical filter, envelope, and send parameters into runtime nodes.~~ Done. Oscillator waveform and bus/master trim are deferred as categorical/project-level controls, not per-device parameters.
4. ~~Add canonical parameter identifiers for the existing command-backed device/effect controls.~~ Done via the shared device-parameter catalog.
5. ~~Implement durable render-job persistence, an HTTP API, and worker wiring.~~ Done: contracts, the in-memory and PostgreSQL-backed stores, the HTTP API, and BFF wiring are all implemented and tested.
6. ~~Implement deterministic offline WAV rendering and checksum evidence.~~ Mostly done: the renderer, encoder, and worker loop exist and are verified deterministic; still missing a real `ProjectLoader` (platform-backend fetch, blocked on an auth decision) and reverb/compression modeling (dry signal only, a documented simplification).
7. Add stem rendering and preview packages. Stems are already supported by the offline renderer's scope handling; what remains is real object-storage upload, naming/manifests, and signed delivery (`FilesystemArtifactSink` is a local-disk placeholder).
8. Add MP3/OGG conversion only after WAV certification.
9. Profile DSP workloads before assigning any kernel to Rust/WASM.

## Stage Started in Parallel

### Stage 13 — Adaptive Game Audio and SynaptixPlay Runtime Integration

Groundwork is implemented (#29–#31): adaptive package contracts and validation, the export builder from certified render-artifact metadata, state selection and transition planning, and SynaptixPlay backend persistence contracts with BFF proxy routes for list/publish/version/delivery-grant operations. This slice does not decode or play audio, and packages cannot be published until Stage 12 produces certified render artifacts.

### Remaining Stage 13 sequence

1. ~~Adaptive package contracts and validation.~~ Done (#29).
2. ~~Export builder from certified render artifacts.~~ Done (#30).
3. SynaptixPlay backend authorization, versioning, retention, and signed delivery (persistence contracts and BFF routes started in #31).
4. Flutter runtime package loader, checksum verification, and offline caching.
5. Beat/bar/phrase-aware transition scheduler (planning logic exists; runtime playback scheduling does not).
6. Layer and stem mixing with intensity interpolation.
7. Stingers, ducking, and gameplay-event mappings.
8. Telemetry for state changes, transition latency, underruns, and asset failures.
9. Cross-device certification and offline fallback.

## Completion Estimate

- Stages 1–11: complete
- Stage 12: approximately 85% complete; production-graph integration, device-parameter binding, the render-job control plane (contracts, both stores, HTTP API, BFF wiring), the offline WAV renderer, and the worker loop are all done and tested — a real project loader (auth decision pending), real artifact storage, reverb/compression modeling, and stems/lossy exports remain
- Stage 13: early groundwork only (contracts, builder, transition planning, platform/BFF routes); blocked on Stage 12 certified artifacts before publication
- Full planned DAW roadmap: approximately 48–52% complete

These estimates describe feature-scope completion, not production-readiness certification.

## Stage 12 Exit Criteria

Stage 12 is complete when:

- browser preview and offline rendering consume the same canonical revision and parameter semantics;
- render jobs are durable, idempotent, cancellable, observable, and recoverable;
- deterministic WAV output is validated by artifact checksums;
- master and stem exports are supported;
- clipping and render warnings are visible and auditable;
- project assets and licenses are resolved without mutable editor-state inference;
- documentation, changelog, release notes, and operational runbooks are current.

## Stage 13 Exit Criteria

Stage 13 is complete when a Flutter/SynaptixPlay client can load a signed package, verify its artifacts, play a default state, transition on beat/bar/phrase boundaries, vary intensity using stems or layers, trigger stingers, recover offline, and emit operational telemetry.

## Revision Date

2026-08-15
