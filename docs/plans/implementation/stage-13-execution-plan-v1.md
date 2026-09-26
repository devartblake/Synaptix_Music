# Stage 13 Execution Plan — Adaptive Game Audio Runtime v1

## Objective

Move from certified Stage 12 render artifacts to a secure, cacheable, musically synchronized adaptive-audio runtime in SynaptixPlay, without exposing DAW state or private storage credentials to clients.

## Entry gate

Implementation can proceed while Stage 12 staging certification is collected, but adaptive-package publication must remain disabled until the Stage 12 certification report passes and the referenced artifacts are immutable and retrievable.

## Execution slices

### Slice 13.1 — Publication hardening

- Complete SynaptixPlay authorization for package owners and entitled consumers.
- Persist immutable package versions and artifact relationships.
- Enforce retention states: active, superseded, revoked, expired.
- Issue bounded signed-delivery grants only for artifacts referenced by a published version.
- Validate each referenced artifact manifest, checksum, render ID, project ID, and revision ID before publication.
- Add idempotent publication and conflict tests.

Exit: an authorized publisher can create one immutable package version from certified Stage 12 evidence; unauthorized or uncertified publication fails closed.

### Slice 13.2 — Flutter loader and offline cache

- Add typed Dart models matching the adaptive package and artifact-manifest contracts.
- Fetch package metadata through the authenticated SynaptixPlay API.
- Download through signed grants, stream SHA-256 verification, and commit files atomically.
- Cache by package/version/artifact checksum with size and age limits.
- Preserve the last verified package for offline fallback; never promote a partial download.

Exit: Flutter loads, verifies, caches, restarts offline, and rejects tampered or expired artifacts.

### Slice 13.3 — Playback clock and transition scheduler

- Introduce one monotonic audio clock and transport state machine.
- Convert the existing immediate/beat/bar/phrase/cue-point planning decisions into runtime scheduling.
- Account for decode/start latency and cancel superseded transitions.
- Add drift thresholds and safe resynchronization at musical boundaries.

Exit: deterministic fixtures demonstrate correct boundary selection and bounded drift across pause/resume and background/foreground transitions.

### Slice 13.4 — Layered stems and intensity

- Decode and align master/stem artifacts from one certified render package.
- Keep layers sample-aligned and phase-safe.
- Map normalized intensity to declared layers with smoothed gain ramps.
- Enforce a decoder/memory budget and fall back to the master artifact when resources are constrained.

Exit: intensity changes are click-free, synchronized, and recover to the declared default/master state.

### Slice 13.5 — Stingers, ducking, and gameplay mappings

- Resolve semantic gameplay events to declared stinger/cue identifiers.
- Schedule stingers on immediate or quantized boundaries.
- Apply bounded attack/hold/release ducking without mutating music-state gain permanently.
- Define priority, cooldown, deduplication, and interruption rules.

Exit: repeated and competing events produce deterministic, bounded behavior with no runaway gain changes.

### Slice 13.6 — Telemetry and operations

- Emit package load/cache outcomes, checksum failures, state changes, transition requests/executions, drift, underruns, fallback, and asset failures.
- Exclude signed URLs, tokens, local file paths, and player-sensitive payloads.
- Add dashboards and alerts for failure rate, p95 load/transition latency, underruns, and fallback usage.

Exit: staging dashboards explain every transition failure and identify device/asset regressions without exposing secrets.

### Slice 13.7 — Cross-device certification and rollout

- Test representative Android/iOS phones and tablets, low-memory devices, headphones/speakers, offline mode, interruptions, and app lifecycle transitions.
- Run long-session leak/thermal/battery checks.
- Roll out behind a server-controlled capability flag with a kill switch and master-only fallback.

Exit: the certification matrix passes, rollback is demonstrated, and release evidence is retained.

## Recommended PR sequence

1. Backend publication hardening and certified-artifact verification.
2. Dart contracts, signed loader, checksum verification, and atomic cache.
3. Runtime audio clock and transition scheduler.
4. Stem alignment and intensity mixer.
5. Stinger/ducking/gameplay-event policy.
6. Telemetry, dashboards, certification harness, and rollout flag.

## Cross-repository ownership

| Area                                               | Repository                      |
| -------------------------------------------------- | ------------------------------- |
| Artifact/adaptive contracts and builder            | `Synaptix_Music`                |
| Package authorization, versions, retention, grants | `TycoonTycoon_Backend`          |
| Flutter loader, cache, scheduler, mixer            | `trivia_tycoon`                 |
| Dashboards and deployment evidence                 | Backend/operations repositories |

## Risks and controls

- Clock drift: monotonic audio time, fixture tests, and resynchronization thresholds.
- Partial/corrupt cache: temporary files, checksum-before-rename, and last-known-good fallback.
- Memory pressure: bounded concurrent decoders and master-only fallback.
- Signed URL leakage: short TTLs and telemetry redaction.
- Revoked packages offline: cached revocation/expiry policy and refresh on connectivity.
- Stage 12 artifact mutation: immutable keys, checksums, and publication-time evidence validation.

## Stage 13 completion definition

A supported Flutter client can securely load one published immutable package, verify and cache every artifact, play the default state, execute musically quantized transitions, interpolate intensity through synchronized layers, trigger stingers with bounded ducking, recover offline, emit privacy-safe telemetry, and fall back safely on constrained devices.

## Status audit — 2026-09-23

Audited against each slice's exit criterion across all three repositories. Before this audit the roadmap reported ~25%; the code actually stood nearer ~45%, because the Flutter loader/cache/scheduler work in `trivia_tycoon` and backend finalization/audit work had landed without roadmap updates. The audit also found three integration defects that would have stopped a real package from playing:

1. `GET /adaptive-packages/{id}` returned no artifact list, so the Flutter client loaded a package with zero artifacts.
2. The Flutter manifest parser read `artifactId`/`stems`, but the canonical contract emits `masterArtifactId`/`stemArtifactIds`, so every state parsed as silent.
3. The Flutter runtime was never bootstrapped (no Dio/cache/base-URL overrides, no `loadPackage`), so gameplay events went to a bus nothing consumed.

It also found that the studio's publish-outcome schema expected `accepted` while the platform serializes `Accepted`. All four are fixed.

| Slice | Status | Exit criterion evidence | Remaining / blocked |
| --- | --- | --- | --- |
| 13.1 Publication hardening | Implemented | Any signed-in player reads the **active** version only; owners see all. Versions start `pending` and activate when every artifact is finalized; `active`/`superseded`/`revoked` are stored, `expired` derives from `expires_at_utc`; one active version per package is enforced by a unique index. Delivery grants and downloads re-check finalization and retention (410 when revoked/expired). Owner revoke rolls players back to the newest unexpired superseded version. Publication validates manifest ↔ request evidence (package/project/revision/checksum), artifact references, checksums, media types and storage keys; reusing an Idempotency-Key with a different request is a conflict. Unit tests plus a Postgres run of the migration, backfill, activation, rollback and idempotency SQL. | **Blocked:** server-side render-ID verification needs the render-worker's job records and accepted Stage 12 staging evidence. Publication stays disabled until then. |
| 13.2 Loader and offline cache | Implemented | Streamed downloads hash incrementally and abort past the granted length; checksum-before-commit; size quota plus unused-age eviction; the last fully verified version is persisted and used offline only if unexpired and completely cached; 404/410 purges cached copies so revoked music never replays; newer verified versions replace older files. After reconnecting, the runtime re-checks the platform: a withdrawn package stops immediately, and a newer version is staged in the background and used from the next load (never mid-match). | On-device verification (part of 13.7). |
| 13.3 Clock and scheduler | Implemented | Monotonic transport clock restarted per state and paused with the app lifecycle; next state's layers load while waiting for the beat/bar/phrase/cue boundary; a boundary missed during loading moves to the next one; superseded transitions never start; drift against the audio position is corrected above 25 ms; authored transition rules (trigger, crossfade, minimum source playback, cue points) override gameplay defaults. Deterministic fixture tests. | Resolved: manifests now carry an optional `clock` (bpm, beats per bar, bars per phrase) taken from the project's tempo map, and runtimes quantize on it. Older manifests without one fall back to the configured tempo. |
| 13.4 Stems and intensity | Implemented | Stems start through one SoLoud voice group (sample-aligned, including resume); intensity maps to per-stem gains with smoothed ramps; a decoder budget and the server stems flag fall back to the master mix; stem start failure retries with the master. | "Click-free" needs listening tests on devices. |
| 13.5 Stingers, ducking, mappings | Implemented | Gameplay events resolve to states by ID **or tag**, so games need not hard-code a package's state IDs. Stingers are manifest states tagged `stinger`, matched by cue tag (e.g. `correct`, `victory`). Quantized scheduling, per-cue cooldowns, a priority-aware minimum gap, one pending stinger with higher-priority replacement, bounded attack/hold/release ducking that always releases to the current intensity gains, and bounded event de-duplication. | Resolved: each state has a Role control (music state, or a stinger for one of the seven gameplay cues). The draft builder keeps stingers out of the default state and transition graph, and rejects duplicate cues. |
| 13.6 Telemetry and operations | Partial | New events: transition cancelled/boundary missed, drift corrected, intensity changed, layer fallback, stinger played/suppressed, offline fallback, package unavailable, and playback underrun. Underruns come from a watchdog that compares the lead layer's position against the lifecycle-aware transport clock, reporting stalls and lost voices once per episode. Every string attribute is redacted (URLs, signed paths, tokens, local paths) and forwarded to the app analytics pipeline. | **Blocked:** dashboards and alerts need staging data and the operations repositories. |
| 13.7 Certification and rollout | Partial | Server flags `adaptive_music_enabled` (kill switch, default off) and `adaptive_music_stems_enabled` (master-only fallback) plus `Music:AdaptiveGamePackageId` in `/app/config`; the mobile entry point bootstraps the runtime only when enabled; revoke-with-rollback is available to owners from the studio. The certification runbook (`docs/operations/stage-13-adaptive-audio-certification.md`) defines the device matrix, functional checks, staged rollout and kill switch. The admin diagnostics screen (Admin dashboard → Adaptive Audio) shows live mixing/timing/health data and runs a 30-minute on-device soak that produces a pass/fail JSON report. | **Blocked:** executing the matrix and soak on physical devices, and retaining the evidence, needs hardware and staging. Known limit: flags are read at app start, so the kill switch affects new sessions; revoke covers running ones on reconnect. |

Estimated Stage 13 completion: **~75% implementation-complete**. No slice has formally met its exit gate yet, because every gate requires either accepted Stage 12 staging evidence or on-device certification.

## Revision date

2026-09-23
