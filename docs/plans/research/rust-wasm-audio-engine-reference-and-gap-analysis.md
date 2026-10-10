# Synaptix_Music — Rust/WASM DAW Research and Implementation Plan

**Date:** 2026-10-10  
**Status:** Architecture review proposed; implementation explicitly deferred  
**Repository:** https://github.com/devartblake/Synaptix_Music  
**Baseline:** main tree inspected 2026-10-10 (tree SHA `56e245b1de3812c052ace163d47cb09e0cc0b093`)

> Documentation-only research. No DSP changes are authorized by this PR. Any Slice A implementation must be proposed and reviewed in a separate pull request.

## Executive summary

Joel Löf's native Rust VST host and Rust/WebAssembly synthesizer demonstrate complementary patterns for Synaptix_Music: graph-based routing, plugin lifecycle and failure containment, audio-thread discipline, browser AudioWorklet integration, oscillator/filter/envelope DSP, MIDI, and preset management. Native VST3 hosting and browser WASM hosting are **distinct execution environments**; a VST3 binary cannot be loaded directly into a browser AudioWorklet.

The current repository already contains a Rust DSP crate, a no-JavaScript-glue WASM ABI, an embedded reproducible WASM binary, browser AudioWorklet plugin hosting, canonical v2 plugin contracts, deterministic offline rendering, and a first-class Frequency Drone device. Therefore, **extend existing seams; do not replace the audio engine or create parallel infrastructure**.

## Sources and limitations

- Joel Löf, RS VST Host: https://joellof.com/rs-vst-host/
- Joel Löf, Building a VST Host in Rust: https://joellof.com/blog/building-a-vst-host-in-rust/
- Joel Löf, Rust/WASM/TypeScript AudioWorklet synthesizer: https://joellof.com/rs-wasm-ts-worklet/
- Native host source: https://github.com/jadujoel/rs-vst-host
- Synaptix_Music: https://github.com/devartblake/Synaptix_Music

The reference projects illustrate techniques, not a grant of code-reuse rights. Audit licenses and transitive dependencies before copying source. The Rust/WASM synth repository link should be reverified if it is unavailable. The Synaptix_Music findings below are grounded in its repository tree and selected source files; this is not a complete line-by-line or runtime performance audit.

## Current implementation cross-reference

| Capability | Verified current location | Evidence / current behavior | Adaptation |
|---|---|---|---|
| Rust DSP workspace | `Cargo.toml`, `crates/dsp` | Cargo workspace already includes DSP and WASM bindings | Extend shared crate; no new engine |
| Browser + Node WASM ABI | `crates/wasm-bindings/src/lib.rs` | Exposes `begin_track`, `render_voice`, `start_voice` and block-processing exports; no JS glue | Add device-oriented state and continuous oscillator ABI after review |
| Reproducible WASM | `packages/dsp-kernel/src/kernel-wasm.ts` | Checked-in generated binary; CI rebuild must match | Keep reproducibility gate and ABI compatibility |
| Browser plugin hosting | `packages/daw-engine/src/audio-worklet-host.ts`, `plugin-host.ts` | Checksum-pinned trusted modules, host registry, automation, MIDI and structured unavailable state | Add WAM adapter behind existing `BrowserPluginHost` interface |
| Drone instrument | `packages/daw-engine/src/frequency-drone.ts`, `frequency-drone-render.ts` | Device settings and TypeScript harmonic renderer | Candidate for migration into shared Rust DSP with parity tests |
| Offline rendering | `services/render-worker/src/offline-renderer.ts` | Uses Node Rust DSP kernel for notes; calls TypeScript drone renderer; deterministic export pipeline | Share drone DSP path without breaking frozen render contracts |
| Adaptive States | `apps/music-studio/app/studio/[projectId]/AdaptiveStatesWorkspace.tsx`, `AdaptiveGraphEditor.tsx` | Adaptive authoring UI exists | Map canonical parameters to graph transitions and test event timing |
| Plugin state / project schema | `packages/project-model/src/v2.ts`, `plugin.ts`, `packages/command-system/src/plugin.ts` | v2 plugin references, commands, frozen evidence and migrations | Preserve IDs, revision history and v1→v2 migration |
| Production export contracts | `packages/render-contracts/src/plugin-freeze.ts`, `services/render-worker/src/plugin-render-gate.ts` | Frozen artifact and eligibility controls | Retain Stage 12 certification and publication gates |
| Prior decisions | `docs/architecture/decisions/adr-0003-browser-preview-vs-production-rendering.md`, `adr-0004-device-parameters-and-production-audio-graph.md` | Explicit preview/export separation and canonical graph | New design must amend, not silently contradict ADRs |
| Prior plugin research | `docs/plans/research/plugin-runtime-foundation-v1-closure.md` | P1 foundation complete at package level; app-wide v2 adoption remains | Avoid duplicate plugin foundation work |

## Technical feature adaptations

### 1. Shared Rust DSP and Drone Instrument (P0, **deferred**)
Joel's synth suggests band-limited oscillators (e.g. PolyBLEP), envelope/filter separation, voice management, parameter smoothing and continuous processing. The existing drone renderer in `packages/daw-engine/src/frequency-drone-render.ts` synthesizes harmonics with a TypeScript sample loop; the render worker imports this path while notes use the Rust kernel. This is the most concrete consolidation target.

**Design requirements:** preserve serialized device settings; provide a stable C-style WASM ABI; avoid allocation/locking in steady-state audio callbacks; support continuous phase across blocks, reset/seek semantics, deterministic modulation and harmonics; test browser-vs-Node parity. PolyBLEP should be used only for discontinuous oscillator shapes; sine harmonics require their own anti-aliasing strategy when upper partials exceed Nyquist.

**Acceptance:** reproducible WASM build; device persistence and undo/redo preserved; sample-block continuity; 44.1/48/96 kHz coverage; offline and browser test vectors within documented tolerances; unchanged frozen-artifact eligibility behavior.

### 2. Graph compilation and routing (P0/P1)
Joel's native host demonstrates a DAG execution plan. Synaptix_Music already has explicit canonical routing and mixer/effect buses. Review its production graph implementation before introducing any new graph planner. Compile changes off the audio thread; validate cycles and unsupported feedback; publish a new plan at a safe block boundary. Preserve sends, mute/solo, meters and device ordering.

**Acceptance:** deterministic topological ordering, cycle rejection, route-change continuity and existing mixer/insert regression tests.

### 3. AudioWorklet real-time performance (P0)
Keep the AudioWorklet callback bounded, allocation-minimized and free of network/file I/O and blocking locks. At 48 kHz, a 128-frame quantum lasts approximately 2.67 ms, but processing should consume only a fraction of that budget. Prefer MessagePort for infrequent commands and consider SharedArrayBuffer only for measured high-rate communication needs; cross-origin isolation and safe synchronization are prerequisites. JS Atomics cannot directly target Float32Array.

**Acceptance:** underrun/glitch profiling under UI load, controlled buffer allocation, safe teardown and worker reconnection behavior.

### 4. Plugin adapters and state management (P1/P2)
Retain `BrowserPluginHost` and `BrowserPluginInstance` as the stable format-neutral seam. Add a WAM v2 adapter only after confirming app-wide schema v2 integration. A native VST3/CLAP companion is a separate future runtime, not a browser-WASM feature. Follow the native host's discovery, lifecycle, latency metadata and crash isolation patterns without copying code before license review.

**Acceptance:** trusted module policy, versioned plugin state, missing-plugin graceful degradation, sample-accurate automation scheduling where supported, frozen plugin evidence and compatibility checks.

### 5. Latency compensation (P1)
Existing plugin instances expose `latencySamples`. Design cumulative path-latency analysis and compensating delay buffers, with clear rules for live monitoring and dynamic changes.

**Acceptance:** phase-aligned parallel paths in offline render, deterministic compensation, no unbounded buffer growth and documented live-monitoring tradeoffs.

### 6. MIDI, presets and Adaptive States (P1)
Integrate hardware MIDI through browser Web MIDI where available; keep native MIDI for a future companion. Preserve editor command history and canonical parameter IDs. Adaptive transitions should map to device parameters rather than mutating runtime-only UI state.

**Acceptance:** MIDI note lifecycle and all-notes-off, preset save/load across revisions, automation/Adaptive mapping tests and deterministic export semantics.

## Proposed architecture

```text
Next.js / TypeScript Studio
    | canonical project v2 + command history
    v
BrowserProductionAudioGraph / plugin registry
    |                          |
    v                          v
AudioWorklet adapter       WAM adapter (future)
    |
    v
Shared Rust DSP crate --> wasm-bindings --> reproducible WASM
    |
    +--> Node offline render worker (same DSP semantics)
    |
    +--> Native audio/plugin companion (future; separate host process)
FastAPI generation / project services remain independent.
```

## Proposed implementation slices (not approved for execution)

| Slice | Scope | Primary locations | Exit gate |
|---|---|---|---|
| A — Shared drone DSP | Move drone oscillator/harmonics/modulation into existing Rust DSP + WASM bindings | `crates/dsp`, `crates/wasm-bindings`, `packages/dsp-kernel`, `packages/daw-engine/src/frequency-drone-render.ts` | WASM/Node/browser parity, deterministic tests, CI |
| B — Browser runtime | Persisted continuous drone playback and smoothing in production graph | `packages/daw-engine`, Studio device inspector | Reload/undo/seek/playback regression |
| C — Graph/export | Graph ordering, latency accounting, shared render path | DAW engine, render worker, render contracts | Golden audio checksums and frozen artifact certification |
| D — Plugin expansion | WAM v2 bridge, then separately evaluate native VST3/CLAP | `plugin-host.ts`, plugin contracts, future companion | Compatibility, licensing, failure containment |

## Implementation controls and review questions

1. **Do not start Slice A in this PR.** Require a separately scoped implementation PR after architecture review.
2. Compare proposed API against current `crates/dsp` voice API and WASM export ABI; document versioning and memory ownership.
3. Confirm current browser production graph's drone lifecycle and determine exactly which DSP paths still diverge.
4. Preserve Project Schema v2, stable device IDs, command-backed parameter edits, persistence and migrations.
5. Ensure Stage 12 frozen-artifact linkage, provenance, rendering gates and Stage 13 publication restrictions remain intact.
6. Define audio parity tolerances, golden fixtures, benchmarks and acceptable platform differences before refactoring.
7. Audit third-party repository licenses, VST3 SDK, CLAP, WAM and Rust dependencies; public source is not automatically reusable.
8. Do not claim production certification without actual runtime, CI and release-evidence records.

## Suggested validation matrix

- Rust: `cargo fmt --check`, `cargo clippy`, `cargo test`; native and WASM build.
- Generated WASM: deterministic rebuild and checked-in artifact comparison.
- TypeScript: formatting, typecheck, DAW engine/plugin/command tests.
- Render worker: drone golden vectors, note/render parity, plugin freeze and artifact manifests.
- Browser: AudioWorklet playback, device inspector, persistence, undo/redo, MIDI, UI and accessibility regression.
- Performance: 128-frame callback measurements, no steady-state allocations, stress tests with multiple devices.
- Release: Stage 12/13 evidence and publication controls unaffected.

## Decision record

**Proposed:** Keep existing Rust DSP + WASM and format-neutral plugin host; prioritize shared drone DSP as the next independent implementation slice after architecture review.  
**Not proposed:** Replacing Tone.js/WebAudio wholesale, introducing a second DSP runtime, running desktop VST3 binaries in a browser, or weakening render/publication certification.  
**Status:** Research documented; Slice A on hold pending explicit authorization.

## Related repository documentation

- `docs/plans/architecture/browser-daw-plugin-extensibility-roadmap-v1.md`
- `docs/plans/architecture/vst-plugin-integration-options-v1.md`
- `docs/plans/research/plugin-runtime-foundation-v1-closure.md`
- `docs/plans/implementation/project-schema-v2-cutover.md`
- `docs/plans/implementation/stage-12-render-pipeline-completion-plan-v1.md`
- `docs/architecture/decisions/adr-0004-device-parameters-and-production-audio-graph.md`
