import {
  pluginReferenceKey,
  pluginUnavailable,
  sha256Hex,
  verifyPluginStateEnvelope,
  type AudioPluginDescriptor
} from "@synaptix/project-model/plugin";
import type { PluginStateEnvelope } from "@synaptix/project-model/v2";

import {
  clampPluginParameter,
  type BrowserPluginHost,
  type BrowserPluginInstance,
  type PluginAudioContext,
  type PluginCreateContext,
  type PluginFailureListener,
  PluginIntegrityError
} from "./plugin-host.ts";

/** A first-party AudioWorklet module bundled with the application (never fetched from a remote origin). */
export interface AudioWorkletModuleDefinition {
  descriptor: AudioPluginDescriptor;
  processorName: string;
  source: string;
}

export interface AudioWorkletPluginHostOptions {
  /** Creates a loadable URL for module source. Defaults to a Blob object URL. */
  createModuleUrl?(source: string): string;
  revokeModuleUrl?(url: string): void;
}

function defaultCreateModuleUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

function defaultRevokeModuleUrl(url: string): void {
  URL.revokeObjectURL(url);
}

export class AudioWorkletPluginHost implements BrowserPluginHost {
  readonly runtimeKind = "audio-worklet" as const;
  private readonly modules = new Map<string, AudioWorkletModuleDefinition>();
  private readonly loaded = new WeakMap<PluginAudioContext, Map<string, Promise<void>>>();
  private readonly createModuleUrl: (source: string) => string;
  private readonly revokeModuleUrl: (url: string) => void;

  constructor(modules: readonly AudioWorkletModuleDefinition[], options: AudioWorkletPluginHostOptions = {}) {
    for (const module of modules) {
      if (module.descriptor.reference.runtimeKind !== "audio-worklet") {
        throw new Error(`Module '${module.processorName}' is not an audio-worklet plug-in.`);
      }
      if (!module.descriptor.reference.moduleChecksumSha256) {
        throw new Error(`Module '${module.processorName}' must pin a module checksum.`);
      }
      this.modules.set(pluginReferenceKey(module.descriptor.reference), module);
    }
    this.createModuleUrl = options.createModuleUrl ?? defaultCreateModuleUrl;
    this.revokeModuleUrl = options.revokeModuleUrl ?? defaultRevokeModuleUrl;
  }

  canHost(descriptor: AudioPluginDescriptor): boolean {
    return this.modules.has(pluginReferenceKey(descriptor.reference));
  }

  private loadModule(audioContext: PluginAudioContext, module: AudioWorkletModuleDefinition): Promise<void> {
    let perContext = this.loaded.get(audioContext);
    if (!perContext) {
      perContext = new Map();
      this.loaded.set(audioContext, perContext);
    }
    const key = module.processorName;
    const existing = perContext.get(key);
    if (existing) return existing;

    const loading = (async () => {
      const checksum = await sha256Hex(module.source);
      if (checksum !== module.descriptor.reference.moduleChecksumSha256) {
        throw new PluginIntegrityError(`Integrity check failed for '${module.processorName}'.`);
      }
      const url = this.createModuleUrl(module.source);
      try {
        await audioContext.addModule(url);
      } finally {
        this.revokeModuleUrl(url);
      }
    })();
    perContext.set(key, loading);
    loading.catch(() => perContext.delete(key));
    return loading;
  }

  async createInstance({ audioContext, device, descriptor }: PluginCreateContext): Promise<BrowserPluginInstance> {
    const module = this.modules.get(pluginReferenceKey(descriptor.reference));
    if (!module) throw new Error(`No AudioWorklet module for '${pluginReferenceKey(descriptor.reference)}'.`);
    await this.loadModule(audioContext, module);
    const outputChannels = descriptor.buses.audioOutputChannels[0] ?? 2;
    const node = audioContext.createAudioWorkletNode(module.processorName, {
      numberOfInputs: descriptor.buses.audioInputChannels.length,
      numberOfOutputs: descriptor.buses.audioOutputChannels.length,
      outputChannelCount: [...descriptor.buses.audioOutputChannels],
      channelCount: outputChannels,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      parameterData: Object.fromEntries(descriptor.parameters.map((parameter) => [parameter.id, parameter.defaultValue]))
    });
    return new AudioWorkletPluginInstance(device.id, descriptor, node, audioContext);
  }
}

class AudioWorkletPluginInstance implements BrowserPluginInstance {
  readonly latencySamples: number;
  private state: PluginStateEnvelope | null = null;
  private readonly listeners = new Set<PluginFailureListener>();
  private readonly parameters: Map<string, AudioPluginDescriptor["parameters"][number]>;
  private disposed = false;

  constructor(
    readonly deviceId: string,
    readonly descriptor: AudioPluginDescriptor,
    private readonly node: AudioWorkletNode,
    private readonly audioContext: PluginAudioContext
  ) {
    this.latencySamples = descriptor.latency.latencySamples;
    this.parameters = new Map(descriptor.parameters.map((parameter) => [parameter.id, parameter]));
    node.onprocessorerror = () => {
      const failure = pluginUnavailable("processor-error", `Processor for device '${deviceId}' failed.`);
      for (const listener of this.listeners) listener(failure);
    };
  }

  get input(): AudioNode { return this.node; }
  get output(): AudioNode { return this.node; }

  private param(id: string): { param: AudioParam; descriptor: AudioPluginDescriptor["parameters"][number] } | null {
    if (this.disposed) return null;
    const descriptor = this.parameters.get(id);
    const param = descriptor ? this.node.parameters.get(id) : undefined;
    return descriptor && param ? { param, descriptor } : null;
  }

  setParameter(id: string, value: number, atTime?: number): void {
    const target = this.param(id);
    if (!target) return;
    target.param.setValueAtTime(clampPluginParameter(target.descriptor, value), atTime ?? this.audioContext.currentTime);
  }

  rampParameter(id: string, value: number, endTime: number): void {
    const target = this.param(id);
    if (!target) return;
    target.param.linearRampToValueAtTime(clampPluginParameter(target.descriptor, value), endTime);
  }

  cancelScheduledParameters(fromTime: number): void {
    for (const id of this.parameters.keys()) this.param(id)?.param.cancelScheduledValues(fromTime);
  }

  getState(): PluginStateEnvelope | null {
    return this.state ? structuredClone(this.state) : null;
  }

  async setState(state: PluginStateEnvelope | null): Promise<void> {
    if (state === null) {
      this.state = null;
      return;
    }
    if (state.encoding !== this.descriptor.state.encoding) throw new Error(`Unsupported state encoding '${state.encoding}'.`);
    if (state.stateVersion > this.descriptor.state.stateVersion) throw new Error(`Unsupported state version ${state.stateVersion}.`);
    if (!(await verifyPluginStateEnvelope(state))) throw new Error("Plug-in state checksum does not match its payload.");
    this.state = structuredClone(state);
  }

  sendMidi(): void {
    // Effects declare no MIDI input; events are ignored rather than rejected.
  }

  allNotesOff(): void {}

  onFailure(listener: PluginFailureListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.node.onprocessorerror = null;
    this.node.port.postMessage({ type: "dispose" });
    this.node.port.close();
    this.node.disconnect();
  }
}
