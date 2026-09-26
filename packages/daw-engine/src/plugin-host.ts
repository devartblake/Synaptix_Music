import {
  pluginReferenceKey,
  pluginUnavailable,
  resolvePluginAvailability,
  type AudioPluginDescriptor,
  type PluginAvailabilityState,
  type PluginParameterDescriptor
} from "@synaptix/project-model/plugin";
import type {
  AutomationPoint,
  DeviceV2,
  PluginReference,
  PluginRuntimeKind,
  PluginStateEnvelope,
  TrackV2
} from "@synaptix/project-model/v2";

/*
 * Browser plug-in host seam (Plugin Runtime Foundation v1, R2 / Slice C).
 *
 * BrowserAudioEngine never branches on concrete plug-in formats. It asks the registry to
 * instantiate each non-builtin device; runtime adapters (AudioWorklet today, WAM and
 * native proxies later) implement BrowserPluginHost. Every failure path returns a
 * structured unavailable state instead of throwing, so a project always stays loadable.
 */

/** The subset of a Web Audio context that plug-in hosts depend on. */
export interface PluginAudioContext {
  readonly sampleRate: number;
  readonly currentTime: number;
  /** Load an AudioWorklet module into this context. */
  addModule(url: string): Promise<void>;
  createAudioWorkletNode(name: string, options?: Partial<AudioWorkletNodeOptions>): AudioWorkletNode;
}

export interface PluginMidiEvent {
  type: "note-on" | "note-off";
  pitch: number;
  velocity: number;
  atTime: number;
}

export type PluginFailureListener = (availability: PluginAvailabilityState) => void;

export interface BrowserPluginInstance {
  readonly deviceId: string;
  readonly descriptor: AudioPluginDescriptor;
  readonly input: AudioNode;
  readonly output: AudioNode;
  readonly latencySamples: number;
  /** Set a parameter immediately, or at an AudioContext time. Values are clamped to the descriptor. */
  setParameter(id: string, value: number, atTime?: number): void;
  /** Ramp a parameter linearly to `value`, arriving at `endTime`. */
  rampParameter(id: string, value: number, endTime: number): void;
  cancelScheduledParameters(fromTime: number): void;
  getState(): PluginStateEnvelope | null;
  setState(state: PluginStateEnvelope | null): Promise<void>;
  sendMidi(event: PluginMidiEvent): void;
  allNotesOff(): void;
  onFailure(listener: PluginFailureListener): () => void;
  /** Idempotent. */
  dispose(): void;
}

/** Thrown by hosts when module bytes do not match the pinned descriptor checksum. */
export class PluginIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginIntegrityError";
  }
}

export interface PluginCreateContext {
  audioContext: PluginAudioContext;
  device: DeviceV2;
  descriptor: AudioPluginDescriptor;
}

export interface BrowserPluginHost {
  readonly runtimeKind: PluginRuntimeKind;
  canHost(descriptor: AudioPluginDescriptor): boolean;
  createInstance(context: PluginCreateContext): Promise<BrowserPluginInstance>;
}

/** Trusted descriptors, keyed by plug-in identity and version. */
export class PluginCatalog {
  private readonly descriptors = new Map<string, AudioPluginDescriptor>();

  constructor(descriptors: readonly AudioPluginDescriptor[] = []) {
    for (const descriptor of descriptors) this.register(descriptor);
  }

  register(descriptor: AudioPluginDescriptor): void {
    const key = pluginReferenceKey(descriptor.reference);
    if (this.descriptors.has(key)) throw new Error(`Plug-in '${key}' is already registered.`);
    this.descriptors.set(key, descriptor);
  }

  descriptorFor(reference: Pick<PluginReference, "pluginId" | "version">): AudioPluginDescriptor | undefined {
    return this.descriptors.get(pluginReferenceKey(reference));
  }

  versionsOf(pluginId: string): string[] {
    return this.list()
      .filter((descriptor) => descriptor.reference.pluginId === pluginId)
      .map((descriptor) => descriptor.reference.version);
  }

  list(): AudioPluginDescriptor[] {
    return [...this.descriptors.values()];
  }
}

export type PluginInstantiation =
  | { status: "ready"; instance: BrowserPluginInstance }
  | { status: "unavailable"; availability: Extract<PluginAvailabilityState, { status: "unavailable" }> };

function unavailable(reason: Parameters<typeof pluginUnavailable>[0], message: string): PluginInstantiation {
  return { status: "unavailable", availability: pluginUnavailable(reason, message) as Extract<PluginAvailabilityState, { status: "unavailable" }> };
}

export class BrowserPluginHostRegistry {
  private readonly hosts: readonly BrowserPluginHost[];

  constructor(readonly catalog: PluginCatalog, hosts: readonly BrowserPluginHost[]) {
    this.hosts = [...hosts];
  }

  /** Deterministic: the first registered host for the device's runtime kind that accepts the descriptor. */
  selectHost(descriptor: AudioPluginDescriptor): BrowserPluginHost | undefined {
    return this.hosts.find((host) => host.runtimeKind === descriptor.reference.runtimeKind && host.canHost(descriptor));
  }

  availability(device: DeviceV2): PluginAvailabilityState {
    const descriptor = this.catalog.descriptorFor(device.plugin);
    if (!descriptor) {
      const versions = this.catalog.versionsOf(device.plugin.pluginId);
      if (versions.length > 0) {
        return pluginUnavailable(
          "version-mismatch",
          `Project requires ${pluginReferenceKey(device.plugin)}; trusted versions: ${versions.join(", ")}.`
        );
      }
    }
    const resolved = resolvePluginAvailability(device, descriptor);
    if (resolved.status === "unavailable" || !descriptor) return resolved;
    if (!this.selectHost(descriptor)) {
      return pluginUnavailable("unsupported-runtime", `No browser host supports runtime '${device.plugin.runtimeKind}'.`);
    }
    return resolved;
  }

  async instantiate(device: DeviceV2, audioContext: PluginAudioContext): Promise<PluginInstantiation> {
    const availability = this.availability(device);
    if (availability.status === "unavailable") return { status: "unavailable", availability };
    const descriptor = this.catalog.descriptorFor(device.plugin)!;
    const host = this.selectHost(descriptor)!;
    let instance: BrowserPluginInstance | null = null;
    try {
      instance = await host.createInstance({ audioContext, device, descriptor });
      await instance.setState(device.pluginState);
      applyDeviceParameters(instance, device);
      return { status: "ready", instance };
    } catch (error) {
      instance?.dispose();
      const message = error instanceof Error && error.message ? error.message : "Plug-in failed to load.";
      return unavailable(error instanceof PluginIntegrityError ? "integrity-mismatch" : "load-failed", message);
    }
  }
}

export function clampPluginParameter(descriptor: PluginParameterDescriptor, value: number): number {
  const finite = Number.isFinite(value) ? value : descriptor.defaultValue;
  const clamped = Math.min(descriptor.maximum, Math.max(descriptor.minimum, finite));
  return descriptor.kind === "continuous" ? clamped : Math.round(clamped);
}

/** Current canonical value for every descriptor parameter: stored value, else the descriptor default. */
export function resolvePluginParameterValues(device: DeviceV2, descriptor: AudioPluginDescriptor): Map<string, number> {
  const stored = new Map(device.parameters.map((parameter) => [parameter.id, parameter.value]));
  return new Map(descriptor.parameters.map((parameter) => [
    parameter.id,
    clampPluginParameter(parameter, stored.get(parameter.id) ?? parameter.defaultValue)
  ]));
}

function applyDeviceParameters(instance: BrowserPluginInstance, device: DeviceV2): void {
  for (const [id, value] of resolvePluginParameterValues(device, instance.descriptor)) instance.setParameter(id, value);
}

export interface PlannedPluginInsert {
  device: DeviceV2;
  availability: PluginAvailabilityState;
}

/**
 * The live insert chain for a track: enabled, non-builtin devices in order. Built-in devices
 * are realized by the built-in instrument runtime; disabled devices are bypassed.
 */
export function planTrackPluginChain(track: TrackV2, registry: BrowserPluginHostRegistry): PlannedPluginInsert[] {
  return track.devices
    .filter((device) => device.enabled && device.plugin.runtimeKind !== "builtin")
    .map((device) => ({ device, availability: registry.availability(device) }));
}

export interface ScheduledAutomationEvent {
  parameterId: string;
  tick: number;
  value: number;
  /** When set, ramp linearly from `value` at `tick` to `rampTo.value` at `rampTo.tick`. */
  rampTo: { tick: number; value: number } | null;
}

/**
 * Translate canonical automation lanes into parameter events. Each point's curve describes
 * the segment that follows it; values are clamped to the descriptor and non-automatable or
 * unknown parameters are ignored.
 */
export function planAutomationEvents(device: DeviceV2, descriptor: AudioPluginDescriptor): ScheduledAutomationEvent[] {
  const parameters = new Map(descriptor.parameters.map((parameter) => [parameter.id, parameter]));
  const events: ScheduledAutomationEvent[] = [];
  for (const lane of device.automation) {
    const parameter = parameters.get(lane.parameterId);
    if (!parameter?.automatable) continue;
    const points: AutomationPoint[] = [...lane.points].sort((left, right) => left.tick - right.tick);
    points.forEach((point, index) => {
      const next = points[index + 1];
      events.push({
        parameterId: lane.parameterId,
        tick: point.tick,
        value: clampPluginParameter(parameter, point.value),
        rampTo: point.curve === "linear" && next && next.tick > point.tick
          ? { tick: next.tick, value: clampPluginParameter(parameter, next.value) }
          : null
      });
    });
  }
  return events.sort((left, right) => left.tick - right.tick || left.parameterId.localeCompare(right.parameterId));
}
