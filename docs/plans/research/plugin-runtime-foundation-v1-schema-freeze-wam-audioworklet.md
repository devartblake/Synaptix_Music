# Plugin Runtime Foundation v1 — Schema, Frozen Artifacts, WAM, and Reference Processor

**Status:** Research slice complete  
**Revision date:** 2026-09-22  
**Branch:** `docs/plugin-runtime-foundation-v1`

## Executive decisions

1. Introduce plug-in project semantics through **Project Schema v2**, with an explicit v1 -> v2 migration.
2. Preserve Stage 12 render/artifact contracts; add a dedicated frozen-plug-in evidence contract that points to Stage 12 artifacts instead of weakening/redefining them.
3. Treat WAM as a runtime adapter, not the Synaptix canonical data model.
4. Keep automation canonical in Synaptix and translate it into WAM events or native AudioParam scheduling inside adapters.
5. Use a **first-party stereo gain/soft-clip AudioWorklet effect** as the reference processor. It is deliberately simpler than a synthesizer so the first slice proves hosting, parameters, state, automation, bypass, failure, and disposal without MIDI/synthesis complexity.

## 1. Schema and Pydantic parity

The current project contract has three strict representations:

- TypeScript/Zod: `packages/project-model/src/index.ts`
- JSON Schema: `schemas/project/v1.json`
- Python/Pydantic: `services/generation-api/app/models/project.py`

The Python validation suite loads the same canonical v1 fixture used by the repository contract.

All three currently represent a device as:

```text
id
deviceType
deviceVersion
enabled
parameters[] { id, numeric value }
```

Both JSON Schema and Pydantic reject unknown fields.

### Decision: Project Schema v2

Do not mutate the meaning of schema v1.

Create:

- `schemas/project/v2.json`
- `schemas/project/fixtures/minimal-v2.json`
- Zod v2 schema/types
- Pydantic v2 project model
- `migrateProjectV1ToV2`
- parity tests proving equivalent acceptance/rejection across Zod, JSON Schema, and Pydantic

Existing v1 revisions remain immutable and readable. Migration produces a new in-memory/current representation and only becomes a new immutable project revision when explicitly persisted through normal revision semantics.

### Proposed v2 device direction

```ts
type PluginRuntimeKind =
  | "builtin"
  | "audio-worklet"
  | "audio-worklet-wasm"
  | "wam"
  | "native-proxy";

interface PluginReference {
  pluginId: string;
  vendorId: string | null;
  version: string;
  runtimeKind: PluginRuntimeKind;
  moduleChecksumSha256: string | null;
}

interface PluginStateEnvelope {
  stateVersion: number;
  encoding: "json" | "base64";
  payload: unknown;
  checksumSha256: string | null;
}
```

A v2 device should retain the existing Synaptix `deviceType` and `deviceVersion` fields for stable internal classification/migration while optionally adding a plug-in reference/state envelope for externally hosted processors.

Do not encode WAM-specific names into the canonical schema.

### v1 -> v2 migration

For existing built-ins:

- runtime kind becomes `builtin`;
- existing device type/version remain unchanged;
- numeric parameters copy unchanged;
- plug-in opaque state is absent/null;
- no frozen artifact is synthesized;
- checksums/provenance are only populated where the repository already has authoritative evidence.

The migration must be deterministic and idempotent.

## 2. Frozen-artifact linkage to Stage 12

Stage 12 already has a strong evidence chain:

```text
RenderManifest
  projectId
  revisionId
  projectChecksumSha256
  engineVersion
  range/scope/output
       |
       v
RenderArtifactManifest
  renderId
  same project/revision/checksum
  engineVersion
  artifact metadata + checksums
```

Stage 13 then consumes certified artifact identity tied to the same project/revision/checksum.

### Decision: do not place raw audio blobs in Device

A plug-in freeze should point to certified render evidence.

Proposed canonical reference:

```ts
interface FrozenPluginArtifactReference {
  renderId: string;
  artifactId: string;
  sourceProjectId: string;
  sourceRevisionId: string;
  sourceProjectChecksumSha256: string;
  sourceDeviceId: string;
  sourcePluginStateChecksumSha256: string;
  artifactChecksumSha256: string;
  engineVersion: string;
}
```

The authoritative artifact metadata remains in Stage 12 contracts/storage.

### Freeze validity

A frozen reference is valid only if:

- project/device identity matches;
- source plug-in state checksum matches;
- relevant source/clip/automation inputs have not changed;
- referenced artifact belongs to the expected render;
- artifact manifest project/revision/checksum evidence is valid;
- artifact checksum verifies.

### Important revision rule

Because a frozen artifact is produced from an immutable source revision, attaching it to a project naturally creates a **descendant revision**. Therefore exact equality with the current revision ID is not the validity rule.

Validity should use explicit source evidence:

```text
current revision
  -> device frozen reference
      -> source revision/checksum
          -> Stage 12 render
              -> artifact manifest
                  -> artifact checksum
```

This avoids a circular requirement where an artifact would have to exist before the revision that references it can be hashed.

### Initial freeze scope

For Plugin Runtime Foundation v1, freeze at **device/track output scope**, not arbitrary internal plug-in graph taps.

The first implementation can use a dedicated plug-in-freeze render contract or a narrowly extended render scope. Do not overload the existing dry track-stem semantics unless the signal point is demonstrably identical.

## 3. WAM v2 mapping

WAM provides a strong adapter target:

| Synaptix concept | WAM concept | Mapping |
| --- | --- | --- |
| plug-in identity | module ID + descriptor/vendor/version | normalize into PluginReference |
| audio graph node | WamNode / audioNode | host adapter connects it |
| serializable state | getState/setState | wrap in PluginStateEnvelope |
| parameter metadata | getParameterInfo | normalize to Synaptix descriptor |
| current parameter values | getParameterValues/setParameterValues | adapter state sync |
| automation | scheduleEvents | translate canonical automation |
| MIDI/events | scheduleEvents | translate canonical event timeline |
| latency | getCompensationDelay | normalize to samples |
| cleanup | destroy | adapter dispose |
| GUI | createGui/destroyGui | optional UI surface, never canonical state |

### Boundary decisions

- Synaptix project files do not persist a raw WAM descriptor as the canonical contract.
- WAM GUI DOM is optional and disposable.
- Synaptix parameter IDs must retain an adapter mapping to WAM parameter IDs.
- Synaptix automation is persisted independently from WAM.
- Host code must not use `setParameterValues` for time-critical automation when WAM scheduling is available.
- WAM state is treated as opaque serializable plug-in state plus checksum.
- WAM modules are loaded only from approved/integrity-verified sources during Alpha/Beta.

### WAM host lifecycle

```text
verify module + checksum
 -> initialize WAM environment/group
 -> import approved module
 -> verify constructor
 -> create instance
 -> inspect descriptor/parameter info
 -> restore state
 -> connect audio node
 -> translate/schedule automation + MIDI
 -> run
 -> capture explicit state changes
 -> destroy GUI
 -> destroy node/instance
```

## 4. AudioWorklet reference processor selection

### Selected processor

**Synaptix Reference Drive** — stereo gain + symmetrical soft clipping.

Proposed exposed parameters:

- `inputGain`: continuous, normalized/dB mapping
- `drive`: continuous
- `mix`: continuous 0..1
- `outputGain`: continuous
- `bypass`: host-level/categorical state rather than audio-rate parameter for v1

DSP can use a simple bounded nonlinear transfer such as `tanh` after input/drive gain and wet/dry mixing.

### Why this processor

It exercises the runtime foundation without conflating it with instrument concerns:

- stereo audio input/output;
- multiple automatable parameters;
- parameter descriptor/range/default mapping;
- state save/restore;
- wet/dry behavior;
- bypass;
- AudioWorklet module loading;
- main-thread/audio-thread separation;
- deterministic unit-testable DSP kernel;
- runtime failure/disposal;
- future JS-vs-WASM benchmark compatibility.

A synthesizer would immediately require MIDI voice allocation, note lifecycle, polyphony, envelopes, and transport/event scheduling. Those should be the **second** reference device after the host foundation is stable.

### Worklet design

```text
ReferenceDrivePluginAdapter
  -> AudioWorkletNode
      -> ReferenceDriveProcessor
          -> pure DSP kernel
```

The DSP kernel should be independently testable without Web Audio.

Use AudioParam descriptors for the continuous controls. Make automation rate explicit rather than relying on defaults.

### Acceptance tests

- module loads only after browser audio initialization;
- stereo signal passes correctly at neutral settings;
- each parameter reports expected range/default;
- parameter changes reach the processor;
- scheduled automation produces expected parameter trajectories;
- state round-trips through canonical project persistence;
- one UI gesture creates one editor history operation;
- undo/redo restores exact canonical state;
- bypass preserves expected signal behavior;
- processor/node disposal is safe and idempotent;
- processor error marks runtime unavailable without corrupting project state;
- save/reload restores identical settings;
- production certification rejects live browser-only processing without valid frozen evidence.

## 5. AudioWorklet technical implications

AudioWorklet is the correct primitive for first-party custom browser DSP because processing runs in the Web Audio rendering thread and custom AudioParams are exposed from processor parameter descriptors.

Implementation constraints:

- production deployment requires a secure context;
- processor module loading is asynchronous;
- processor communication outside AudioParams uses MessagePort;
- DSP must avoid allocations/blocking work in `process()`;
- do not hard-code application logic around a permanent 128-frame render quantum;
- processor lifecycle must be explicit;
- parameter automation rate should be explicit.

## 6. Updated implementation sequence

### Slice A — schema v2 foundation

1. Add v2 JSON Schema.
2. Add v2 canonical fixture.
3. Add Zod v2 schema/types.
4. Add Pydantic v2 parity.
5. Implement deterministic v1 -> v2 migration.
6. Add cross-language parity/migration tests.

### Slice B — plug-in evidence contracts

1. Add PluginReference/PluginStateEnvelope schemas.
2. Add frozen-artifact reference.
3. Define freeze invalidation helper/state machine.
4. Validate references against Stage 12 manifest evidence.
5. Add descendant-revision and stale-freeze tests.

### Slice C — browser host seam

1. Add BrowserPluginHost/BrowserPluginInstance interfaces.
2. Adapt one existing built-in runtime through the seam.
3. Add structured unavailable/failure state.
4. Preserve current BrowserAudioEngine behavior.

### Slice D — Reference Drive AudioWorklet

1. Add pure DSP kernel.
2. Add AudioWorkletProcessor.
3. Add host adapter.
4. Add inspector controls and command-backed persistence.
5. Add automation scheduling.
6. Add lifecycle/error tests.

### Slice E — WAM adapter spike

1. Initialize WAM environment/group.
2. Load one approved test WAM.
3. Normalize descriptor/parameters.
4. Restore/capture state.
5. Translate automation and MIDI events.
6. Read compensation delay.
7. Dispose cleanly.
8. Verify project fallback when unavailable.

## 7. Exit criteria for this research slice

This research slice is closed because:

- current Zod/JSON Schema/Pydantic parity has been verified;
- the migration strategy is explicit;
- Stage 12 artifact evidence has a non-circular freeze linkage model;
- WAM concepts map cleanly without contaminating canonical state;
- automation ownership is defined;
- the first AudioWorklet processor is selected;
- implementation order and acceptance criteria are defined.

## Next action

Begin **Slice A — Project Schema v2 foundation**. This is the smallest implementation step that unlocks every later plug-in runtime task while remaining independent of WAM/VST implementation.
