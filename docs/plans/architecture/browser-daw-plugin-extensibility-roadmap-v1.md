# Browser DAW and Plug-in Extensibility — Actionable Roadmap

**Status:** Proposed  
**Revision date:** 2026-09-22  
**Scope:** Browser DAW extensibility, AudioWorklet/WAM, WebAssembly DSP, native VST3 bridging, licensing, rendering, and adaptive-game-audio integration.

## Decision summary

Synaptix Music should use a three-tier audio-extension architecture:

1. **Browser-native:** built-in devices, AudioWorklet processors, Web Audio Modules (WAM), and profiling-driven WASM DSP.
2. **Local/native bridge:** an isolated companion host for locally installed VST3 plug-ins; future formats may be added behind the same contract.
3. **Production rendering:** the existing deterministic render pipeline, frozen plug-in artifacts, and only later explicitly certified native plug-in workers.

Native VST3 hosting is **not** a Stage 13 dependency. Stage 12 certification and Stage 13 adaptive-audio delivery retain priority.

## Product position

Do not compete by recreating a general-purpose desktop DAW in a browser. Synaptix Music should optimize the workflow:

```text
idea
  -> generated/procedural arrangement
  -> human DAW editing
  -> browser-native processing
  -> optional native plug-in processing
  -> deterministic/frozen production artifacts
  -> adaptive game-audio package
  -> SynaptixPlay runtime
```

Competitive references should be used for patterns, not copied implementations:

- Soundtrap: accessible browser production and collaboration.
- Soundation: browser production, collaboration, and AI-assisted creation.
- BandLab: cloud/social creator workflow.
- Amped Studio: browser DAW with a native VST/VST3 companion bridge.
- openDAW: deep browser-native audio architecture and Rust/WASM reference patterns.
- Web Audio Modules: interoperable browser plug-in model.

## Architecture

### Tier 1 — browser-native plug-ins

Use Web Audio as the real-time execution boundary. Custom DSP belongs in `AudioWorkletProcessor`; WASM is an implementation option for measured DSP workloads, not a project-model dependency.

Supported runtime kinds should evolve toward:

- `builtin`
- `wam`
- `audio-worklet`
- `audio-worklet-wasm`
- `vst3-native` (later)
- future native formats only through explicit adapters

The canonical project model must reference stable device identity, versioned state, parameters, automation, latency/tail metadata, provenance, and fallback artifacts without embedding untrusted binaries.

### Tier 2 — local native bridge

A future Synaptix plug-in bridge should:

- host locally installed VST3 plug-ins outside the browser;
- use localhost/private authenticated IPC;
- isolate plug-ins in child processes or equivalent crash boundaries;
- expose discovery, parameters, state/presets, MIDI/events, latency, and render/freeze operations;
- never receive platform, database, or object-storage administrative credentials;
- preserve projects when a plug-in is missing;
- treat freeze/bounce as a first-class portability mechanism.

Start with Windows for the first spike unless product requirements establish a stronger target. Do not make Wine compatibility a production guarantee.

### Tier 3 — production rendering

Keep browser preview and production rendering separate.

Production may consume:

- deterministic built-in renderer semantics;
- certified frozen/bounced artifacts;
- later, separately licensed and certified native plug-in workers.

Do not place arbitrary native plug-ins inside the existing Node.js render worker.

## Core contract

Promote the existing format-neutral plug-in concept into a DAW-wide abstraction.

```text
AudioPluginDescriptor
  identity: plugin/vendor/version
  runtimeKind
  audio + MIDI/event buses
  parameter descriptors
  automation capabilities
  state format/version
  latency + tail
  module/binary checksum
  provenance + license metadata
  compatibility requirements
```

Related contracts should include:

- `PluginInstanceState`
- `PluginParameterDescriptor`
- `PluginAvailabilityState`
- `PluginLatencyMetadata`
- `PluginLicenseMetadata`
- `FrozenPluginArtifact`
- `BrowserPluginHost`
- runtime-specific host adapters

All meaningful parameter/state mutations remain command-backed and undoable.

## Freeze/bounce and missing-plug-in behavior

A plug-in-backed project must remain usable on devices that cannot execute the original processor.

Required behavior:

1. Preserve exact plug-in identity and serialized state.
2. Store or reference a certified frozen artifact when requested/required.
3. Mark unavailable plug-ins explicitly; never silently substitute another processor.
4. Use live processing when the compatible plug-in is available.
5. Use the frozen artifact for browser/mobile/collaboration/game-runtime contexts when native execution is unavailable.
6. Allow reactivation only when compatible identity/version/state requirements are satisfied.

This is required before production native VST3 support.

## WAM and AudioWorklet plan

WAM/AudioWorklet should precede native VST3 implementation.

Initial policy:

- first-party and explicitly reviewed modules only;
- allowlisted module origins;
- HTTPS and integrity/checksum validation;
- immutable module versions;
- DSP in AudioWorklet, UI/editor mutation on the editor side;
- no arbitrary remote JavaScript;
- no arbitrary uploaded WASM;
- module checksum and provenance recorded in project/render evidence.

Build one first-party reference processor to prove the complete host lifecycle.

## Rust/WASM policy

Retain the current profiling-driven rule.

Good candidates:

- time/pitch processing;
- FFT/spectral processing;
- convolution;
- advanced filters/oversampling;
- physical/neural synthesis or amp processing;
- heavy analysis/resampling.

Do not move ordinary gain, pan, routing, editor state, or simple automation into Rust without evidence.

Add benchmark fixtures before expanding the Rust/WASM surface.

## Cross-origin isolation

High-performance shared-memory WASM may require `SharedArrayBuffer`, cross-origin isolation, COOP/COEP, and compatible asset delivery.

Create a certification gate covering:

- Chrome/Edge;
- Firefox;
- Safari;
- AudioWorklet module loading;
- WAM/module loading;
- WASM;
- workers;
- CDN/sample assets;
- signed/private asset delivery;
- CSP/CORS/CORP/COEP compatibility.

No production dependency on shared memory should land before this deployment model is proven.

## Security model

Treat third-party modules and native plug-ins as untrusted code.

Required controls:

- immutable identity/version/checksum;
- publisher/provenance records;
- allowlisting for Alpha/Beta;
- explicit license acceptance where required;
- native crash isolation;
- CPU/memory/duration limits;
- filesystem/network restrictions where technically possible;
- quarantine after crashes/timeouts;
- revocation capability;
- no automatic installation from project files;
- no platform secrets in plug-in processes.

A future public marketplace requires signing, review, revocation, incident response, and publisher governance.

## Licensing rules

### VST3

The current VST3 SDK is MIT-licensed. VST/VST3 trademark/logo usage remains governed separately by Steinberg's trademark guidelines.

### Individual plug-ins

Do not infer cloud/render-farm rights from a user's desktop license. Track at least:

- local use allowed;
- commercial use allowed;
- redistribution allowed;
- server/cloud render allowed;
- multi-user/concurrent use allowed;
- license activation requirements.

Model local availability separately from cloud-approved availability.

### WAM and browser modules

The host/API licensing may be permissive, but every third-party module still requires its own provenance and license record.

### openDAW

openDAW is an architectural/reference input only. Preserve clean-room development. Do not copy substantial AGPL implementation into a proprietary Synaptix product without legal review or an appropriate commercial license.

## Ordered execution plan

### P0 — preserve current release gates

- Complete Stage 12 staging certification.
- Continue Stage 13 publication/runtime execution.
- Keep adaptive package publication disabled until Stage 12 evidence is accepted.
- Do not add VST3 as a Stage 13 dependency.

### P1 — Plugin Runtime Foundation v1

- Define format-neutral plug-in contracts.
- Define schema evolution/migration approach.
- Define host/runtime interfaces.
- Implement one first-party AudioWorklet reference processor.
- Persist state and parameters.
- Route parameter edits through commands/undo/redo.
- Add missing-plug-in and frozen-artifact semantics.
- Add tests for serialization, migration, undo/redo, save/reload, unavailable devices, and deterministic metadata.

### P2 — WAM compatibility

- Implement/prototype a trusted WAM host adapter.
- Validate parameter/state/automation/MIDI interoperability.
- Establish registry/integrity policy.
- Add browser compatibility and failure-isolation tests.

### P3 — browser DSP certification

- Benchmark AudioWorklet JS vs selected WASM kernels.
- Validate cross-origin isolation and SharedArrayBuffer requirements.
- Establish CPU/xrun/latency budgets.
- Certify supported browsers and fallback behavior.

### P4 — VST3 Local Bridge Spike

- Build a separate native companion process.
- Start with administrator/user-approved local plug-in directories.
- Discover one known VST3.
- Expose descriptor, state, parameters, MIDI/events, latency, and freeze/render.
- Add authenticated localhost/private IPC.
- Isolate plug-in execution.
- Prove browser project fallback to frozen audio.
- Do not add cloud VST hosting.

### P5 — native production catalog, only if justified

- Establish explicit per-plug-in licensing clearance.
- Separate worker capacity by OS/architecture.
- Add signing/provenance/malware review.
- Add resource quotas and crash quarantine.
- Reuse Stage 12 artifact contracts.
- Require deterministic/frozen output evidence where exact live repeatability cannot be guaranteed.

## Release gates

Plugin Runtime Foundation v1 is complete when:

- the canonical project can represent a format-neutral plug-in instance;
- a first-party AudioWorklet device can load and process audio;
- parameters are command-backed and automatable;
- state survives save/reload and immutable revisions;
- missing-device behavior preserves project integrity;
- freeze/bounce metadata is represented;
- integrity/provenance/license metadata has a defined contract;
- tests cover schema, runtime lifecycle, history, persistence, and fallback;
- existing Stage 12/13 behavior remains green.

Native VST3 remains a later gate.

## Immediate next action

Execute the companion research plan in:

`docs/plans/research/plugin-runtime-foundation-v1-research-plan.md`

The research must close contract, runtime, security, deployment, licensing, benchmark, and test questions before implementation scope is frozen.
