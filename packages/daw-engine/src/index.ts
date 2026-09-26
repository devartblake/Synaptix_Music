export { buildFrequencyDroneRenderPlan, renderFrequencyDroneMono, type FrequencyDroneRenderPlan } from "./frequency-drone-render.ts";
export {
  FREQUENCY_DRONE_DEVICE_TYPE, DRONE_FREQUENCY_PARAMETER, DRONE_GAIN_PARAMETER,
  DRONE_HARMONICS_PARAMETER, DRONE_MOD_RATE_PARAMETER, DRONE_MOD_DEPTH_PARAMETER,
  DRONE_FILTER_PARAMETER, DRONE_STEREO_OFFSET_PARAMETER,
  DEFAULT_FREQUENCY_DRONE_DEVICE_SETTINGS, createFrequencyDroneTrack,
  frequencyDroneDevices, resolveFrequencyDroneDevice,
  type FrequencyDroneDeviceSettings
} from "./frequency-drone.ts";
export { BrowserProductionAudioGraph } from "./browser-production-graph.ts";
export {
  createInstrumentTrack,
  INSTRUMENT_CATALOG,
  instrumentDefinition,
  resolveInstrumentDefinition,
  type CreateInstrumentTrackOptions,
  type InstrumentDefinition,
  type InstrumentOscillator
} from "./instrument-catalog.ts";
export {
  meterSnapshot,
  normalizeMeterValue,
  primaryDevice,
  resolveEffectiveInstrumentSettings,
  resolveTrackOutput,
  resolveTrackSend,
  resolveInstrumentProfile,
  SILENT_METER,
  type EffectiveInstrumentSettings,
  type InstrumentProfile,
  type InstrumentProfileKind,
  type MasterMeterSnapshot
} from "./production-audio.ts";
export {
  clampDeviceParameterValue,
  deviceParameterDefinition,
  DEVICE_PARAMETER_DEFINITIONS,
  ENVELOPE_ATTACK_PARAMETER,
  ENVELOPE_DECAY_PARAMETER,
  ENVELOPE_RELEASE_PARAMETER,
  ENVELOPE_SUSTAIN_PARAMETER,
  FILTER_FREQUENCY_PARAMETER,
  resolveDeviceParameterValue,
  REVERB_SEND_PARAMETER,
  type DeviceParameterDefinition,
  type DeviceParameterUnit
} from "./device-parameters.ts";

export {
  BrowserPluginHostRegistry,
  clampPluginParameter,
  PluginCatalog,
  PluginIntegrityError,
  planAutomationEvents,
  planTrackPluginChain,
  pluginInstanceReuseKey,
  resolvePluginParameterValues,
  TrackPluginChain,
  type BrowserPluginHost,
  type BrowserPluginInstance,
  type PlannedPluginInsert,
  type PluginAudioContext,
  type PluginCreateContext,
  type PluginInsertTarget,
  type PluginInstantiation,
  type PluginMidiEvent,
  type ScheduledAutomationEvent
} from "./plugin-host.ts";
export { AudioWorkletPluginHost, type AudioWorkletModuleDefinition, type AudioWorkletPluginHostOptions } from "./audio-worklet-host.ts";
export { createDefaultPluginHostRegistry, FIRST_PARTY_AUDIO_WORKLET_MODULES } from "./default-plugins.ts";
export {
  createReferenceDriveDevice,
  REFERENCE_DRIVE_DESCRIPTOR,
  REFERENCE_DRIVE_DRIVE_PARAMETER,
  REFERENCE_DRIVE_INPUT_GAIN_PARAMETER,
  REFERENCE_DRIVE_MIX_PARAMETER,
  REFERENCE_DRIVE_MODULE_CHECKSUM,
  REFERENCE_DRIVE_OUTPUT_GAIN_PARAMETER,
  REFERENCE_DRIVE_PLUGIN_ID,
  REFERENCE_DRIVE_PROCESSOR_NAME,
  REFERENCE_DRIVE_PROCESSOR_SOURCE,
  REFERENCE_DRIVE_VERSION
} from "./reference-drive.ts";

import type { MusicProject, MusicalPosition, Track } from "@synaptix/project-model";
import type { PluginAvailabilityState } from "@synaptix/project-model/plugin";
import { projectV2BuiltinView, type MusicProjectV2, type TrackV2 } from "@synaptix/project-model/v2";
import * as Tone from "tone";

import {
  BrowserProductionAudioGraph,
  type ProductionInstrumentRuntime,
  type FrequencyDroneRuntime
} from "./browser-production-graph.ts";
import { createDefaultPluginHostRegistry } from "./default-plugins.ts";
import {
  planAutomationEvents,
  planTrackPluginChain,
  pluginInstanceReuseKey,
  resolvePluginParameterValues,
  TrackPluginChain,
  type BrowserPluginHostRegistry,
  type BrowserPluginInstance,
  type PluginAudioContext,
  type PluginInsertTarget
} from "./plugin-host.ts";
import { SILENT_METER, type MasterMeterSnapshot } from "./production-audio.ts";
import { FREQUENCY_DRONE_DEVICE_TYPE } from "./frequency-drone.ts";

export interface TransportSnapshot {
  initialized: boolean;
  playing: boolean;
  positionSeconds: number;
  positionTicks: number;
  tempo: number;
  loopEnabled: boolean;
}

export interface NoteAuditionRequest {
  trackId: string;
  pitch: number;
  velocity?: number;
  durationSeconds?: number;
}

export type TransportListener = (snapshot: TransportSnapshot) => void;
export type MasterMeterListener = (snapshot: MasterMeterSnapshot) => void;

export interface PluginRuntimeStatus {
  trackId: string;
  deviceId: string;
  pluginId: string;
  availability: PluginAvailabilityState | { status: "loading" } | { status: "inactive"; message: string };
}

export type PluginStatusListener = (statuses: PluginRuntimeStatus[]) => void;

export interface BrowserAudioEngineOptions {
  /** Trusted plug-in hosts. Defaults to the first-party AudioWorklet allowlist. */
  pluginRegistry?: BrowserPluginHostRegistry;
}

/**
 * Project Schema v1 view used by the built-in instrument runtime. Plug-in devices are
 * realized separately as insert chains, so only builtin devices are kept here.
 */
export const builtinProjectView = projectV2BuiltinView;

export interface AudioTransport {
  initialize(): Promise<void>;
  loadProject(project: MusicProject | MusicProjectV2): void;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(position: MusicalPosition): void;
  setLoop(enabled: boolean): void;
  auditionNote(request: NoteAuditionRequest): Promise<void>;
  allNotesOff(): void;
  snapshot(): TransportSnapshot;
  meter(): MasterMeterSnapshot;
  subscribe(listener: TransportListener, intervalMs?: number): () => void;
  subscribeMeter(listener: MasterMeterListener, intervalMs?: number): () => void;
  subscribeChannelMeters(listener: (meters: Record<string, MasterMeterSnapshot>) => void, intervalMs?: number): () => void;
  dispose(): void;
}

function positionToTicks(position: MusicalPosition, beatsPerBar = 4, ppq = 960): number {
  return position.bar * beatsPerBar * ppq + position.beat * ppq + position.tick;
}

function trackAudible(track: Track, tracks: readonly Track[]): boolean {
  const anySolo = tracks.some((candidate) => candidate.solo);
  return !track.muted && (!anySolo || track.solo);
}

function clampMidiValue(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error("MIDI audition values must be finite numbers.");
  return Math.min(maximum, Math.max(minimum, value));
}

function browserAudioAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.AudioContext !== "undefined";
}

export class BrowserAudioEngine implements AudioTransport {
  private initialized = false;
  private project: MusicProject | MusicProjectV2 | null = null;
  private graph: BrowserProductionAudioGraph | null = null;
  private readonly runtimes = new Map<string, ProductionInstrumentRuntime>();
  private readonly droneRuntimes = new Map<string, FrequencyDroneRuntime>();
  private scheduledEventIds: number[] = [];
  private readonly subscriptions = new Set<ReturnType<typeof setInterval>>();
  private readonly pluginRegistry: BrowserPluginHostRegistry;
  private readonly pluginChains = new Map<string, TrackPluginChain>();
  private readonly pluginInstanceMeta = new Map<BrowserPluginInstance, { key: string; unsubscribe: () => void }>();
  private readonly pluginStatus = new Map<string, PluginRuntimeStatus>();
  private readonly pluginStatusListeners = new Set<PluginStatusListener>();
  private pluginContext: { tone: Tone.BaseContext; adapter: PluginAudioContext } | null = null;
  private graphGeneration = 0;

  constructor(options: BrowserAudioEngineOptions = {}) {
    this.pluginRegistry = options.pluginRegistry ?? createDefaultPluginHostRegistry();
  }

  private ensureGraph(): BrowserProductionAudioGraph {
    if (!browserAudioAvailable()) {
      throw new Error("Browser audio is only available after client hydration.");
    }
    this.graph ??= new BrowserProductionAudioGraph();
    return this.graph;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.ensureGraph();
    await Tone.start();
    this.initialized = true;
  }

  loadProject(project: MusicProject | MusicProjectV2): void {
    this.project = structuredClone(project);
    if (!browserAudioAvailable()) return;

    this.ensureGraph();
    const transport = Tone.getTransport();
    transport.PPQ = project.transport.ticksPerQuarterNote;
    transport.bpm.value = project.tempoMap[0]?.bpm ?? 120;
    transport.loop = project.transport.loopEnabled;

    if (project.transport.loopRange) {
      const startTicks = positionToTicks(
        project.transport.loopRange.start,
        project.timeSignatureMap[0]?.numerator ?? 4,
        project.transport.ticksPerQuarterNote
      );
      transport.loopStart = `${startTicks}i`;
      transport.loopEnd = `${startTicks + project.transport.loopRange.durationTicks}i`;
    }

    this.ensureGraph().configure(builtinProjectView(project));
    this.rebuildAudioGraph(project);
  }

  private rebuildAudioGraph(source: MusicProject | MusicProjectV2): void {
    const graph = this.ensureGraph();
    this.clearScheduledEvents();
    const reusable = this.releasePluginInstances();
    this.disposeRuntimes();
    const generation = ++this.graphGeneration;
    const project = builtinProjectView(source);
    const pluginTracks = source.schemaVersion === 2 ? new Map(source.tracks.map((track) => [track.id, track])) : null;
    const beatsPerBar = project.timeSignatureMap[0]?.numerator ?? 4;
    const ppq = project.transport.ticksPerQuarterNote;

    for (const track of project.tracks) {
      const pluginTrack = pluginTracks?.get(track.id);
      if (track.kind !== "instrument") {
        // The browser engine only plays instrument tracks; say so instead of "loading" forever.
        for (const device of pluginTrack?.devices ?? []) {
          if (!device.enabled || device.plugin.runtimeKind === "builtin") continue;
          this.setPluginStatus({
            trackId: track.id, deviceId: device.id, pluginId: device.plugin.pluginId,
            availability: { status: "inactive", message: `Browser preview does not play ${track.kind} tracks yet.` }
          });
        }
        continue;
      }
      const drone = graph.createFrequencyDrone(track);
      if (drone) {
        drone.channel.mute = !trackAudible(track, project.tracks);
        this.droneRuntimes.set(track.id, drone);
        if (pluginTrack) void this.attachPluginChain(pluginTrack, drone, generation, reusable);
        continue;
      }
      const runtime = graph.createInstrument(track);
      runtime.channel.mute = !trackAudible(track, project.tracks);
      this.runtimes.set(track.id, runtime);
      if (pluginTrack) void this.attachPluginChain(pluginTrack, runtime, generation, reusable);

      for (const clip of track.clips) {
        if (clip.kind !== "midi") continue;
        const clipStartTicks = positionToTicks(clip.range.start, beatsPerBar, ppq);
        for (const note of clip.notes) {
          const eventId = Tone.getTransport().schedule((time) => {
            runtime.synth.triggerAttackRelease(
              Tone.Frequency(note.pitch, "midi").toFrequency(),
              `${note.durationTicks}i`,
              time,
              note.velocity / 127
            );
          }, `${clipStartTicks + note.startTick}i`);
          this.scheduledEventIds.push(eventId);
        }
      }
    }
    // Instances whose devices were removed, changed identity/state, or were bypassed.
    for (const instance of reusable.values()) instance.dispose();
    this.emitPluginStatus();
  }

  private pluginAudioContext(): PluginAudioContext {
    const tone = Tone.getContext();
    if (this.pluginContext?.tone === tone) return this.pluginContext.adapter;
    const adapter: PluginAudioContext = {
      get sampleRate() { return tone.sampleRate; },
      get currentTime() { return tone.currentTime; },
      addModule: (url) => {
        const worklet = tone.rawContext.audioWorklet;
        if (!worklet) return Promise.reject(new Error("AudioWorklet requires a secure context (https or localhost)."));
        return worklet.addModule(url);
      },
      createAudioWorkletNode: (name, options) => tone.createAudioWorkletNode(name, options)
    };
    this.pluginContext = { tone, adapter };
    return adapter;
  }

  private setPluginStatus(status: PluginRuntimeStatus): void {
    this.pluginStatus.set(`${status.trackId}:${status.deviceId}`, status);
  }

  /**
   * Build a track's plug-in insert chain after the built-in runtime. Instances whose identity
   * and state are unchanged are reused from the previous graph (parameters re-applied), so
   * edits and transport changes do not interrupt processing; new ones load asynchronously
   * into their planned slots. Unavailable plug-ins are bypassed (never substituted) and
   * reported through pluginStatuses(); the canonical project is never modified.
   */
  private async attachPluginChain(
    track: TrackV2,
    runtime: PluginInsertTarget,
    generation: number,
    reusable: Map<string, BrowserPluginInstance>
  ): Promise<void> {
    const planned = planTrackPluginChain(track, this.pluginRegistry);
    if (planned.length === 0) return;
    const chain = new TrackPluginChain(runtime, planned.length);
    this.pluginChains.set(track.id, chain);
    const status = (deviceId: string, pluginId: string, availability: PluginRuntimeStatus["availability"]) =>
      this.setPluginStatus({ trackId: track.id, deviceId, pluginId, availability });

    const toLoad: { index: number; device: TrackV2["devices"][number] }[] = [];
    planned.forEach(({ device, availability }, index) => {
      if (availability.status === "unavailable") {
        status(device.id, device.plugin.pluginId, availability);
        return;
      }
      const key = pluginInstanceReuseKey(track.id, device);
      const reused = reusable.get(key);
      if (reused) {
        reusable.delete(key);
        reused.cancelScheduledParameters(this.pluginAudioContext().currentTime);
        for (const [id, value] of resolvePluginParameterValues(device, reused.descriptor)) reused.setParameter(id, value);
        this.adoptPluginInstance(track.id, chain, index, device, reused, key);
        status(device.id, device.plugin.pluginId, { status: "available" });
      } else {
        status(device.id, device.plugin.pluginId, { status: "loading" });
        toLoad.push({ index, device });
      }
    });
    chain.attach();
    this.emitPluginStatus();

    for (const { index, device } of toLoad) {
      const result = await this.pluginRegistry.instantiate(device, this.pluginAudioContext());
      if (generation !== this.graphGeneration || chain.isDisposed) {
        if (result.status === "ready") result.instance.dispose();
        return;
      }
      if (result.status === "unavailable") {
        status(device.id, device.plugin.pluginId, result.availability);
      } else {
        this.adoptPluginInstance(track.id, chain, index, device, result.instance, pluginInstanceReuseKey(track.id, device));
        status(device.id, device.plugin.pluginId, { status: "available" });
      }
      this.emitPluginStatus();
    }
  }

  private adoptPluginInstance(
    trackId: string,
    chain: TrackPluginChain,
    index: number,
    device: TrackV2["devices"][number],
    instance: BrowserPluginInstance,
    key: string
  ): void {
    const unsubscribe = instance.onFailure((availability) => {
      this.setPluginStatus({ trackId, deviceId: device.id, pluginId: device.plugin.pluginId, availability });
      this.pluginInstanceMeta.get(instance)?.unsubscribe();
      this.pluginInstanceMeta.delete(instance);
      chain.remove(instance);
      this.emitPluginStatus();
    });
    this.pluginInstanceMeta.set(instance, { key, unsubscribe });
    chain.fill(index, instance);
    this.scheduleAutomation(device, instance);
  }

  /** Detach every live instance from the current graph so the next rebuild can reuse it. */
  private releasePluginInstances(): Map<string, BrowserPluginInstance> {
    const released = new Map<string, BrowserPluginInstance>();
    for (const chain of this.pluginChains.values()) {
      for (const instance of chain.release()) {
        const meta = this.pluginInstanceMeta.get(instance);
        this.pluginInstanceMeta.delete(instance);
        meta?.unsubscribe();
        if (meta && !released.has(meta.key)) released.set(meta.key, instance);
        else instance.dispose();
      }
    }
    this.pluginChains.clear();
    return released;
  }

  private scheduleAutomation(device: TrackV2["devices"][number], instance: BrowserPluginInstance): void {
    const transport = Tone.getTransport();
    for (const event of planAutomationEvents(device, instance.descriptor)) {
      const eventId = transport.schedule((time) => {
        instance.setParameter(event.parameterId, event.value, time);
        if (event.rampTo) {
          instance.rampParameter(
            event.parameterId,
            event.rampTo.value,
            time + Tone.Ticks(event.rampTo.tick - event.tick).toSeconds()
          );
        }
      }, `${event.tick}i`);
      this.scheduledEventIds.push(eventId);
    }
  }

  /** Live status of every plug-in insert in the loaded project. */
  pluginStatuses(): PluginRuntimeStatus[] {
    return [...this.pluginStatus.values()].map((status) => structuredClone(status));
  }

  subscribePluginStatus(listener: PluginStatusListener): () => void {
    this.pluginStatusListeners.add(listener);
    listener(this.pluginStatuses());
    return () => { this.pluginStatusListeners.delete(listener); };
  }

  private emitPluginStatus(): void {
    const statuses = this.pluginStatuses();
    for (const listener of this.pluginStatusListeners) listener(statuses);
  }

  async play(): Promise<void> { await this.initialize(); Tone.getTransport().start(); }
  pause(): void {
    if (!browserAudioAvailable()) return;
    Tone.getTransport().pause();
    this.allNotesOff();
  }
  stop(): void {
    if (!browserAudioAvailable()) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.seconds = 0;
    this.allNotesOff();
  }

  seek(position: MusicalPosition): void {
    if (!this.project) throw new Error("A project must be loaded before seeking.");
    if (!browserAudioAvailable()) return;
    Tone.getTransport().ticks = positionToTicks(
      position,
      this.project.timeSignatureMap[0]?.numerator ?? 4,
      this.project.transport.ticksPerQuarterNote
    );
  }

  setLoop(enabled: boolean): void {
    if (!browserAudioAvailable()) return;
    Tone.getTransport().loop = enabled;
  }

  async auditionNote({ trackId, pitch, velocity = 100, durationSeconds = 0.18 }: NoteAuditionRequest): Promise<void> {
    await this.initialize();
    const track = this.project?.tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.kind !== "instrument") {
      throw new Error(`Track ${trackId} is not available for audition.`);
    }
    // Drones sound continuously and have no note input to preview.
    if (track.devices.some((device) => device.deviceType === FREQUENCY_DRONE_DEVICE_TYPE)) return;
    this.ensureGraph().auditionNote(
      track,
      Tone.Frequency(clampMidiValue(Math.round(pitch), 0, 127), "midi").toFrequency(),
      clampMidiValue(durationSeconds, 0.03, 2),
      clampMidiValue(velocity, 1, 127) / 127
    );
  }

  /** Panic: release every sounding note, including note previews. */
  allNotesOff(): void {
    for (const runtime of this.runtimes.values()) runtime.synth.releaseAll();
    for (const chain of this.pluginChains.values()) for (const instance of chain.instances) instance.allNotesOff();
    this.graph?.stopAuditions();
  }

  snapshot(): TransportSnapshot {
    if (!browserAudioAvailable()) {
      return {
        initialized: false,
        playing: false,
        positionSeconds: 0,
        positionTicks: 0,
        tempo: this.project?.tempoMap[0]?.bpm ?? 120,
        loopEnabled: this.project?.transport.loopEnabled ?? false
      };
    }

    const transport = Tone.getTransport();
    return {
      initialized: this.initialized,
      playing: transport.state === "started",
      positionSeconds: transport.seconds,
      positionTicks: transport.ticks,
      tempo: transport.bpm.value,
      loopEnabled: Boolean(transport.loop)
    };
  }

  meter(): MasterMeterSnapshot { return this.graph?.meter() ?? SILENT_METER; }

  subscribe(listener: TransportListener, intervalMs = 33): () => void {
    const safeInterval = Math.max(16, Math.round(intervalMs));
    listener(this.snapshot());
    const timer = setInterval(() => listener(this.snapshot()), safeInterval);
    this.subscriptions.add(timer);
    return () => { clearInterval(timer); this.subscriptions.delete(timer); };
  }

  subscribeMeter(listener: MasterMeterListener, intervalMs = 50): () => void {
    const safeInterval = Math.max(16, Math.round(intervalMs));
    listener(this.meter());
    const timer = setInterval(() => listener(this.meter()), safeInterval);
    this.subscriptions.add(timer);
    return () => { clearInterval(timer); this.subscriptions.delete(timer); };
  }

  subscribeChannelMeters(listener: (meters: Record<string, MasterMeterSnapshot>) => void, intervalMs = 80): () => void {
    const read = () => listener(this.graph?.channelMeters() ?? {});
    read();
    const timer = setInterval(read, Math.max(50, intervalMs));
    this.subscriptions.add(timer);
    return () => { clearInterval(timer); this.subscriptions.delete(timer); };
  }

  private clearScheduledEvents(): void {
    if (!browserAudioAvailable()) {
      this.scheduledEventIds = [];
      return;
    }
    const transport = Tone.getTransport();
    for (const eventId of this.scheduledEventIds) transport.clear(eventId);
    this.scheduledEventIds = [];
  }

  private disposeRuntimes(): void {
    this.graph?.clearTracks();
    this.graphGeneration += 1;
    for (const chain of this.pluginChains.values()) chain.dispose();
    this.pluginChains.clear();
    for (const { unsubscribe } of this.pluginInstanceMeta.values()) unsubscribe();
    this.pluginInstanceMeta.clear();
    this.pluginStatus.clear();
    for (const runtime of this.runtimes.values()) runtime.dispose();
    this.runtimes.clear();
    for (const runtime of this.droneRuntimes.values()) runtime.dispose();
    this.droneRuntimes.clear();
  }

  dispose(): void {
    this.stop();
    for (const timer of this.subscriptions) clearInterval(timer);
    this.subscriptions.clear();
    this.clearScheduledEvents();
    this.disposeRuntimes();
    this.graph?.dispose();
    this.graph = null;
    this.project = null;
    this.pluginContext = null;
    this.pluginStatusListeners.clear();
    this.initialized = false;
  }
}
