import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";
import { computePluginStatePayloadChecksum } from "@synaptix/project-model/plugin";
import { migrateProjectV1ToV2, type DeviceV2, type MusicProjectV2, type TrackV2 } from "@synaptix/project-model/v2";

import { AudioWorkletPluginHost } from "./audio-worklet-host.ts";
import { createDefaultPluginHostRegistry, FIRST_PARTY_AUDIO_WORKLET_MODULES } from "./default-plugins.ts";
import { BrowserAudioEngine, builtinProjectView } from "./index.ts";
import {
  BrowserPluginHostRegistry,
  PluginCatalog,
  planAutomationEvents,
  planTrackPluginChain,
  type PluginAudioContext
} from "./plugin-host.ts";
import { createReferenceDriveDevice, REFERENCE_DRIVE_DESCRIPTOR } from "./reference-drive.ts";

type ParamEvent = [kind: string, value: number, time: number];

class FakeParam {
  readonly events: ParamEvent[] = [];
  setValueAtTime(value: number, time: number) { this.events.push(["set", value, time]); return this; }
  linearRampToValueAtTime(value: number, time: number) { this.events.push(["ramp", value, time]); return this; }
  cancelScheduledValues(time: number) { this.events.push(["cancel", 0, time]); return this; }
}

class FakeWorkletNode {
  readonly parameters: Map<string, FakeParam>;
  readonly messages: unknown[] = [];
  portClosed = false;
  disconnects = 0;
  onprocessorerror: (() => void) | null = null;
  readonly port = {
    postMessage: (message: unknown) => { this.messages.push(message); },
    close: () => { this.portClosed = true; }
  };

  constructor(readonly name: string, readonly options: Partial<AudioWorkletNodeOptions>) {
    this.parameters = new Map(Object.keys(options.parameterData ?? {}).map((id) => [id, new FakeParam()]));
  }

  disconnect() { this.disconnects += 1; }
}

function fakeContext(addModule: (url: string) => Promise<void> = async () => {}) {
  const nodes: FakeWorkletNode[] = [];
  const modules: string[] = [];
  const context: PluginAudioContext = {
    sampleRate: 48000,
    currentTime: 1.5,
    addModule: (url) => { modules.push(url); return addModule(url); },
    createAudioWorkletNode: (name, options = {}) => {
      const node = new FakeWorkletNode(name, options);
      nodes.push(node);
      return node as unknown as AudioWorkletNode;
    }
  };
  return { context, nodes, modules };
}

function registry(revoked: string[] = []) {
  return createDefaultPluginHostRegistry({
    createModuleUrl: (source) => `blob:module-${source.length}`,
    revokeModuleUrl: (url) => { revoked.push(url); }
  });
}

function driveDevice(overrides: Partial<DeviceV2> = {}): DeviceV2 {
  return { ...createReferenceDriveDevice("device-drive"), ...overrides };
}

test("the registry instantiates the Reference Drive, loading its module once per context", async () => {
  const revoked: string[] = [];
  const hosts = registry(revoked);
  const { context, nodes, modules } = fakeContext();

  const first = await hosts.instantiate(driveDevice({ parameters: [{ id: "drive", value: 50 }, { id: "mix", value: 0.25 }] }), context);
  const second = await hosts.instantiate(driveDevice({ id: "device-2" }), context);
  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  assert.equal(modules.length, 1);
  assert.deepEqual(revoked, modules);

  const node = nodes[0]!;
  assert.equal(node.name, "synaptix-reference-drive");
  assert.deepEqual(node.options.outputChannelCount, [2]);
  assert.deepEqual(node.options.parameterData, { inputGainDb: 0, drive: 1, mix: 1, outputGainDb: 0 });
  // Stored values are applied and clamped; missing ones fall back to descriptor defaults.
  assert.deepEqual(node.parameters.get("drive")!.events, [["set", 20, 1.5]]);
  assert.deepEqual(node.parameters.get("mix")!.events, [["set", 0.25, 1.5]]);
  assert.deepEqual(node.parameters.get("outputGainDb")!.events, [["set", 0, 1.5]]);
});

test("unknown, mismatched, and non-browser plug-ins are reported unavailable without throwing", async () => {
  const hosts = registry();
  const { context, nodes } = fakeContext();
  const reasons = await Promise.all([
    driveDevice({ plugin: { ...REFERENCE_DRIVE_DESCRIPTOR.reference, pluginId: "vendor.unknown" } }),
    driveDevice({ plugin: { ...REFERENCE_DRIVE_DESCRIPTOR.reference, version: "9.0.0" } }),
    driveDevice({ plugin: { ...REFERENCE_DRIVE_DESCRIPTOR.reference, moduleChecksumSha256: "0".repeat(64) } })
  ].map(async (device) => {
    const result = await hosts.instantiate(device, context);
    return result.status === "unavailable" ? result.availability.reason : "ready";
  }));
  assert.deepEqual(reasons, ["unknown-plugin", "version-mismatch", "integrity-mismatch"]);
  assert.equal(nodes.length, 0);

  const noHosts = new BrowserPluginHostRegistry(new PluginCatalog([REFERENCE_DRIVE_DESCRIPTOR]), []);
  const result = await noHosts.instantiate(driveDevice(), context);
  assert.equal(result.status === "unavailable" && result.availability.reason, "unsupported-runtime");
});

test("module bytes that do not match the pinned checksum are never loaded", async () => {
  const tampered = new BrowserPluginHostRegistry(new PluginCatalog([REFERENCE_DRIVE_DESCRIPTOR]), [
    new AudioWorkletPluginHost(
      [{ ...FIRST_PARTY_AUDIO_WORKLET_MODULES[0]!, source: `${FIRST_PARTY_AUDIO_WORKLET_MODULES[0]!.source}\n// injected` }],
      { createModuleUrl: () => "blob:tampered", revokeModuleUrl: () => {} }
    )
  ]);
  const { context, modules } = fakeContext();
  const result = await tampered.instantiate(driveDevice(), context);
  assert.equal(result.status === "unavailable" && result.availability.reason, "integrity-mismatch");
  assert.deepEqual(modules, []);
});

test("a failed module load is reported and retried on the next instantiation", async () => {
  let fail = true;
  const hosts = registry();
  const { context, modules } = fakeContext(async () => { if (fail) throw new Error("network down"); });
  const failed = await hosts.instantiate(driveDevice(), context);
  assert.equal(failed.status === "unavailable" && failed.availability.reason, "load-failed");
  fail = false;
  assert.equal((await hosts.instantiate(driveDevice(), context)).status, "ready");
  assert.equal(modules.length, 2);
});

test("plug-in state is verified before restore and round-trips through the instance", async () => {
  const hosts = registry();
  const { context, nodes } = fakeContext();
  const payload = JSON.stringify({ preset: "warm" });
  const state = { stateVersion: 1, encoding: "json" as const, payload, checksumSha256: await computePluginStatePayloadChecksum({ encoding: "json", payload }) };

  const ready = await hosts.instantiate(driveDevice({ pluginState: state }), context);
  assert.ok(ready.status === "ready");
  assert.deepEqual(ready.instance.getState(), state);

  const tampered = await hosts.instantiate(driveDevice({ pluginState: { ...state, payload: "{}" } }), context);
  assert.equal(tampered.status === "unavailable" && tampered.availability.reason, "load-failed");
  assert.equal(nodes.at(-1)!.disconnects, 1, "a failed restore disposes the half-created node");
});

test("parameters, ramps, failures, and idempotent disposal reach the worklet node", async () => {
  const hosts = registry();
  const { context, nodes } = fakeContext();
  const ready = await hosts.instantiate(driveDevice(), context);
  assert.ok(ready.status === "ready");
  const { instance } = ready;
  const node = nodes[0]!;
  const mix = node.parameters.get("mix")!;
  mix.events.length = 0;

  instance.setParameter("mix", 2, 3);
  instance.rampParameter("mix", -1, 4);
  instance.setParameter("unknown", 1);
  instance.cancelScheduledParameters(5);
  assert.deepEqual(mix.events, [["set", 1, 3], ["ramp", 0, 4], ["cancel", 0, 5]]);

  const failures: string[] = [];
  instance.onFailure((availability) => { if (availability.status === "unavailable") failures.push(availability.reason); });
  node.onprocessorerror?.();
  assert.deepEqual(failures, ["processor-error"]);

  instance.dispose();
  instance.dispose();
  assert.equal(node.disconnects, 1);
  assert.deepEqual(node.messages, [{ type: "dispose" }]);
  assert.equal(node.portClosed, true);
  instance.setParameter("mix", 0.5);
  assert.equal(mix.events.length, 3);
});

function v2Track(devices: DeviceV2[]): TrackV2 {
  return { id: "track-1", name: "Lead", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, devices, clips: [] };
}

const BUILTIN: DeviceV2 = {
  id: "device-synth", deviceType: "synaptix.basic-synth", deviceVersion: "1.0.0", enabled: true,
  parameters: [{ id: "filterFrequency", value: 1200 }],
  plugin: { pluginId: "synaptix.basic-synth", vendorId: "synaptix", version: "1.0.0", runtimeKind: "builtin", moduleChecksumSha256: null },
  pluginState: null, automation: [], frozen: null
};

test("track insert chains skip built-in and bypassed devices and keep unknown ones visible", () => {
  const unknown = driveDevice({ id: "device-unknown", plugin: { ...REFERENCE_DRIVE_DESCRIPTOR.reference, pluginId: "vendor.unknown" } });
  const planned = planTrackPluginChain(v2Track([BUILTIN, driveDevice(), driveDevice({ id: "bypassed", enabled: false }), unknown]), registry());
  assert.deepEqual(planned.map((insert) => [insert.device.id, insert.availability.status]), [
    ["device-drive", "available"],
    ["device-unknown", "unavailable"]
  ]);
});

test("automation lanes become clamped, ordered parameter events with linear ramps", () => {
  const device = driveDevice({
    automation: [
      { parameterId: "mix", points: [{ tick: 960, value: 0, curve: "step" }, { tick: 0, value: 5, curve: "linear" }] },
      { parameterId: "notAParameter", points: [{ tick: 0, value: 1, curve: "step" }] },
      { parameterId: "drive", points: [{ tick: 480, value: 4, curve: "linear" }] }
    ]
  });
  assert.deepEqual(planAutomationEvents(device, REFERENCE_DRIVE_DESCRIPTOR), [
    { parameterId: "mix", tick: 0, value: 1, rampTo: { tick: 960, value: 0 } },
    { parameterId: "drive", tick: 480, value: 4, rampTo: null },
    { parameterId: "mix", tick: 960, value: 0, rampTo: null }
  ]);
});

test("the built-in runtime sees a v1 view without plug-in devices or fields", () => {
  const project: MusicProjectV2 = migrateProjectV1ToV2(createEmptyProject("project-1", { revisionId: "revision-1", now: "2026-09-22T00:00:00.000Z" }));
  project.tracks.push(v2Track([BUILTIN, driveDevice()]));
  const view = builtinProjectView(project);
  assert.equal(view.schemaVersion, 1);
  assert.deepEqual(view.tracks[0]!.devices, [{
    id: "device-synth", deviceType: "synaptix.basic-synth", deviceVersion: "1.0.0", enabled: true,
    parameters: [{ id: "filterFrequency", value: 1200 }]
  }]);

  const engine = new BrowserAudioEngine();
  assert.doesNotThrow(() => engine.loadProject(project));
  assert.deepEqual(engine.pluginStatuses(), []);
  assert.equal(engine.snapshot().tempo, 120);
  engine.dispose();
});
