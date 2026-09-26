# Plugin Runtime Foundation v1 — R1/R2/R5 Initial Findings

**Status:** Initial repository research  
**Revision date:** 2026-09-22  
**Research plan:** `plugin-runtime-foundation-v1-research-plan.md`

## Scope inspected

- `packages/project-model/src/index.ts`
- `packages/command-system/src/device.ts`
- `packages/daw-engine/src/index.ts`
- `packages/daw-engine/src/browser-production-graph.ts`
- `packages/daw-engine/src/device-parameters.ts`
- existing Stage 12 browser/production render semantics

## Finding 1 — schema v1 is intentionally small

Current `Device` state is:

```ts
{
  id: string;
  deviceType: string;
  deviceVersion: string;
  enabled: boolean;
  parameters: Array<{ id: string; value: number }>;
}
```

This is sufficient for current built-in devices but not sufficient for a general plug-in runtime because it cannot represent:

- runtime kind;
- vendor/plugin identity independent of Synaptix device type;
- categorical/boolean/string parameters;
- opaque serialized preset/state;
- bus/capability declarations;
- latency/tail;
- module/binary checksum;
- provenance/license metadata;
- missing/unavailable state;
- frozen artifact linkage.

### Initial decision

Do **not** overload `parameters[].value` to carry non-numeric data.

Preserve numeric automation-friendly parameters as a fast/common path, and add versioned plug-in instance metadata/state through an explicit schema evolution.

## Finding 2 — existing command semantics should be retained

`SetDeviceParameterEditorCommand` already:

- captures previous and next numeric values;
- creates a reversible command;
- writes into canonical project state;
- participates in existing revision/persistence/history infrastructure.

The studio also treats a parameter UI gesture as one command rather than committing every intermediate pointer movement.

### Initial decision

Retain this pattern for continuous numeric parameters.

Add distinct atomic command families for:

- replace plug-in serialized state/preset;
- categorical parameter changes;
- plug-in availability/fallback decisions only where these are user-editable project state;
- freeze/bounce artifact attachment or invalidation.

Do not create immutable revisions at audio-rate automation frequency.

## Finding 3 — BrowserAudioEngine currently owns too much concrete instrument knowledge

`BrowserAudioEngine.rebuildAudioGraph()` currently chooses between a frequency-drone runtime and the ordinary production instrument runtime, then directly schedules MIDI against a Tone.js synth.

`BrowserProductionAudioGraph` likewise creates concrete Tone.js graphs.

This works for built-ins but becomes a branching hotspot if WAM/AudioWorklet/native proxies are added directly.

### Initial decision

Introduce a runtime adapter seam before adding WAM:

```ts
interface BrowserPluginHost {
  canHost(device: Device): boolean;
  createInstance(context: PluginCreateContext): Promise<BrowserPluginInstance>;
}

interface BrowserPluginInstance {
  readonly deviceId: string;
  readonly latencySamples: number;
  connect(destination: AudioNodeLike): void;
  setParameter(id: string, value: number, atTime?: number): void;
  setState(state: PluginSerializedState): Promise<void>;
  sendMidi(event: PluginMidiEvent): void;
  allNotesOff(): void;
  dispose(): void;
}
```

Exact types remain research output; this is the architectural seam, not a frozen API.

Built-in Tone.js devices should first be adapted behind this seam so WAM is not a special path.

## Finding 4 — preview/render semantic sharing must remain contract-based

The current browser graph and deterministic offline renderer intentionally share canonical parameter resolution while using different execution implementations.

That ADR-0003 property must survive plug-ins.

### Initial decision

Classify runtime behavior:

1. **deterministic built-in:** production renderer has equivalent semantics;
2. **browser-only module:** production requires a certified freeze/bounce;
3. **future native module:** production uses freeze/bounce unless the exact plug-in/version is explicitly certified for a native render worker.

Never assume AudioWorklet output is the production certification source.

## Proposed schema direction

Prefer a backward-compatible device extension followed by an explicit project schema migration once fields become required.

Conceptual shape:

```ts
type PluginRuntimeKind =
  | "builtin"
  | "wam"
  | "audio-worklet"
  | "audio-worklet-wasm"
  | "vst3-native";

interface PluginReference {
  pluginId: string;
  vendorId?: string;
  version: string;
  runtimeKind: PluginRuntimeKind;
  checksumSha256?: string;
}

interface PluginSerializedState {
  format: string;
  version: number;
  payload: string; // encoded/structured representation chosen after R1 validation
  checksumSha256?: string;
}

interface FrozenPluginArtifactReference {
  artifactId: string;
  sourceRevisionId: string;
  sourceStateChecksum: string;
}
```

Open question: whether plug-in metadata belongs directly on `Device` or under a discriminated device extension. The latter gives stronger validation but has a larger migration footprint.

## Proposed parameter direction

Separate three concerns:

- **descriptor:** supported parameter type/range/unit/default/automation capability;
- **instance value:** current canonical value;
- **automation data:** time-varying values, introduced separately rather than conflated with current state.

For v1, retain numeric project parameters for continuous automation-compatible controls. Add typed categorical state only where required by the first reference processor.

## Host lifecycle direction

Target lifecycle:

```text
load canonical project
  -> resolve descriptor/runtime kind
  -> select host adapter
  -> verify module identity/integrity
  -> create instance
  -> restore canonical state
  -> apply parameters
  -> connect to bus graph
  -> schedule MIDI/events
  -> run
  -> capture state when explicitly changed
  -> dispose deterministically
```

A failed host must return a structured unavailable state; it must not make the project unloadable.

## R5 command/history direction

### Continuous parameter gesture

```text
pointer down -> capture canonical initial value
pointer move -> preview runtime updates only
pointer up -> one SetDeviceParameter command
              -> one canonical mutation/history entry
```

### Preset/state replacement

```text
select/import preset
  -> capture previous serialized state
  -> validate next state
  -> one ReplacePluginState command
  -> rebuild/update runtime
```

### Automation

Do not write one editor command per automation sample.

Research a separate automation-lane/event model whose editing operations are command-backed while playback schedules the resulting data against audio time.

## Required implementation tests derived from this slice

- schema v1 projects continue to parse/migrate;
- unknown plug-in metadata survives round-trip;
- unavailable plug-in does not prevent project load;
- host selection is deterministic by runtime kind/capability;
- host disposal is idempotent;
- numeric gesture creates one history operation;
- undo/redo restores exact values;
- state replacement is atomic and reversible;
- failed runtime restoration leaves canonical state intact;
- browser-only plug-in requires frozen output for certified production rendering;
- stale frozen artifact is detected when source state changes.

## Next research actions

1. Inspect canonical JSON schema/Pydantic parity and migration conventions before freezing the Device schema extension.
2. Inspect StudioClient gesture implementation and history/revision transaction boundaries in detail.
3. Inspect Stage 12 artifact manifest contracts to determine the exact frozen-artifact linkage.
4. Research WAM v2 descriptor/state/parameter interfaces against this proposed host seam.
5. Select the first-party AudioWorklet reference processor after R1/R2 contract decisions stabilize.

## Current recommendation

Proceed with a **format-neutral host seam and schema research first**. Do not write WAM-specific or VST3-specific project fields. The existing command/history system is reusable; the primary required change is richer device identity/state plus runtime adapter isolation.
