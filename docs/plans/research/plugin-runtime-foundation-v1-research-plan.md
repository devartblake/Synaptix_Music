# Plugin Runtime Foundation v1 — Research Plan

**Status:** Closed for P1 (see `plugin-runtime-foundation-v1-closure.md`); R4 continues in P2, R8/R9 in P3  
**Revision date:** 2026-09-22  
**Parent plan:** `docs/plans/architecture/browser-daw-plugin-extensibility-roadmap-v1.md`

## Objective

Produce implementation-ready evidence for a format-neutral browser plug-in runtime that fits Synaptix Music's canonical project, command/history, BrowserAudioEngine, deterministic rendering, and Stage 13 adaptive-audio architecture.

This research intentionally excludes production native VST3 hosting. VST3 is considered only to ensure the contracts do not block a later local bridge.

## Research questions

### R1 — canonical contracts

Determine the minimum stable contract for:

- plug-in identity/vendor/version;
- runtime kind;
- audio/MIDI/event buses;
- parameter IDs, types, ranges, units, defaults, automation flags;
- serialized state and state-version migration;
- latency and effect-tail metadata;
- module/binary checksum;
- provenance/license/compatibility metadata;
- missing/unavailable state;
- frozen-artifact references.

**Deliverable:** proposed TypeScript/Zod shape plus schema-evolution notes.

**Decision gate:** no runtime implementation until a project can preserve an unknown/unavailable plug-in without data loss.

### R2 — host abstraction

Map the existing `BrowserAudioEngine`/production graph and determine the smallest host interface supporting:

- instantiate/dispose;
- connect/disconnect;
- set/get state;
- set/schedule parameters;
- MIDI/event input;
- latency/tail reporting;
- bypass/enablement;
- health/failure state.

Compare adapters for:

- built-in devices;
- raw AudioWorklet;
- AudioWorklet + WASM;
- WAM;
- future native proxy.

**Deliverable:** interface proposal and lifecycle sequence.

### R3 — first-party AudioWorklet reference processor

Select a deliberately bounded processor, preferably a filter, delay, distortion, or dynamics device.

Prototype/research must prove:

- module loading;
- AudioWorkletNode/Processor lifecycle;
- parameter registration;
- automation;
- state serialization;
- bypass;
- deterministic descriptor identity;
- editor/runtime separation;
- error/disposal behavior.

**Deliverable:** processor selection, API sketch, acceptance tests, and implementation estimate.

### R4 — WAM compatibility

Validate current WAM v2 host expectations against Synaptix architecture:

- descriptor mapping;
- parameter mapping;
- state;
- MIDI/events;
- GUI ownership;
- transport;
- latency;
- module loading;
- lifecycle/disposal.

Identify where Synaptix should wrap WAM semantics rather than expose them directly to the canonical model.

**Deliverable:** WAM mapping matrix and go/no-go conditions for P2.

### R5 — command/history and automation

Determine how plug-in state changes integrate with existing commands and immutable revisions.

Research:

- parameter gesture begin/update/end;
- coalescing high-frequency UI edits;
- undo/redo;
- automation write vs ordinary parameter edits;
- state/preset replacement as atomic commands;
- persistence failure recovery;
- reload/revision switching;
- adaptive-state parameter mappings.

**Deliverable:** command model and regression-test matrix.

### R6 — freeze/bounce and deterministic rendering

Define portability behavior for devices unavailable to the browser, mobile runtime, collaborators, or render worker.

Research:

- frozen artifact identity;
- project/revision/plugin-state linkage;
- stale-freeze detection;
- invalidation rules after parameter/MIDI/source edits;
- master vs stem scope;
- reactivation when the live plug-in returns;
- interaction with Stage 12 artifact manifests;
- Stage 13 adaptive packages.

**Deliverable:** frozen-artifact state machine and manifest linkage.

### R7 — security and trust

Threat-model browser modules and the future native bridge.

Browser questions:

- CSP;
- origin allowlist;
- integrity/checksum;
- arbitrary JS/WASM rejection;
- module revocation;
- worker/worklet failure handling.

Future native questions:

- localhost authentication;
- process isolation;
- plug-in scanning;
- filesystem/network exposure;
- CPU/memory/time limits;
- crash quarantine.

**Deliverable:** threat model with Alpha/Beta controls.

### R8 — cross-origin isolation and deployment

Determine whether target DSP paths require shared WASM memory.

Test/research:

- COOP/COEP configuration;
- `crossOriginIsolated`;
- SharedArrayBuffer availability;
- CDN/signed asset compatibility;
- WAM/module imports;
- service workers/workers;
- local development behavior;
- Chrome/Edge/Firefox/Safari differences.

**Deliverable:** deployment requirements and compatibility matrix.

### R9 — AudioWorklet/WASM performance

Build a benchmark design before committing DSP to Rust/WASM.

Measure:

- JS AudioWorklet baseline;
- WASM AudioWorklet baseline;
- JS<->WASM boundary overhead;
- CPU load;
- underrun/xrun indicators;
- initialization cost;
- memory;
- multiple concurrent instances;
- representative low/mid/high device profiles.

**Deliverable:** benchmark harness specification and thresholds for moving a kernel to Rust/WASM.

### R10 — licensing/provenance model

Define machine-readable metadata for:

- source/publisher;
- license identifier/text reference;
- commercial-use status;
- redistribution status;
- cloud-render status;
- multi-user status;
- trademark/branding restrictions;
- acceptance/audit evidence.

Validate the model against VST3 SDK/trademark separation, third-party VST licensing, WAM modules, and clean-room openDAW reference use.

**Deliverable:** license/provenance schema proposal and review checklist.

## Repository investigation targets

Research should inspect at minimum:

- `packages/project-model`
- `packages/command-system`
- `packages/daw-engine`
- `packages/render-contracts`
- `apps/music-studio`
- `services/render-worker`
- Stage 12 render/certification documentation
- Stage 13 adaptive-package/runtime documentation
- existing VST architecture decision

## External primary references

Prioritize primary specifications and upstream projects:

- W3C Web Audio / AudioWorklet specification;
- MDN deployment guidance for AudioWorklet, SharedArrayBuffer, and cross-origin isolation;
- Web Audio Modules API/SDK;
- WebAssembly specification and browser support evidence;
- Steinberg VST3 SDK/developer portal and trademark guidance;
- openDAW upstream repository/license as a reference boundary;
- Amped Studio VST Remote behavior as a product-pattern reference.

Do not use product marketing claims as substitutes for technical specifications.

## Planned research artifacts

1. `plugin-runtime-contract-v1.md` — proposed canonical/runtime contracts.
2. `plugin-runtime-host-mapping-v1.md` — BrowserAudioEngine + AudioWorklet/WAM integration.
3. `plugin-runtime-security-licensing-v1.md` — trust, provenance, license, deployment controls.
4. `plugin-runtime-benchmark-plan-v1.md` — AudioWorklet/WASM benchmark and browser matrix.
5. Implementation backlog/issues after the decisions above are closed.

## Acceptance criteria for research closure

Research is complete when:

- every R1–R10 question has an evidence-backed answer or explicit deferred decision;
- the schema migration path is known;
- host interfaces are implementation-ready;
- one reference processor is selected;
- WAM integration has explicit boundaries;
- freeze/bounce invalidation semantics are specified;
- security and licensing metadata are defined;
- browser deployment requirements are known;
- benchmark thresholds are agreed;
- test cases can be converted directly into implementation acceptance criteria;
- no decision compromises Stage 12 deterministic artifacts or Stage 13 adaptive package guarantees.

## First research slice

Start with **R1 + R2 + R5** because they define the architectural seam that all other work depends on:

1. inspect the current project-model device representation;
2. inspect BrowserAudioEngine/device graph boundaries;
3. inspect device parameter commands and history behavior;
4. draft the format-neutral descriptor/state contracts;
5. draft BrowserPluginHost and adapter lifecycle;
6. map command/undo/automation semantics;
7. identify schema migration and backwards-compatibility tests.

Only after that should R3 implement the first AudioWorklet reference processor.

## Non-goals

- loading native `.vst3` binaries in the browser;
- arbitrary user-uploaded plug-ins;
- cloud VST hosting;
- VST2;
- public marketplace;
- copying openDAW implementation code;
- replacing the deterministic Stage 12 renderer with browser output.
