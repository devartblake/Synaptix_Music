export { BrowserProductionAudioGraph } from "./browser-production-graph.ts";
export {
  meterSnapshot,
  normalizeMeterValue,
  resolveInstrumentProfile,
  SILENT_METER,
  type InstrumentProfile,
  type InstrumentProfileKind,
  type MasterMeterSnapshot
} from "./production-audio.ts";

import type { MusicProject, MusicalPosition, Track } from "@synaptix/project-model";
import * as Tone from "tone";

import {
  BrowserProductionAudioGraph,
  type ProductionInstrumentRuntime
} from "./browser-production-graph.ts";
import { SILENT_METER, type MasterMeterSnapshot } from "./production-audio.ts";

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

export interface AudioTransport {
  initialize(): Promise<void>;
  loadProject(project: MusicProject): void;
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
  private project: MusicProject | null = null;
  private graph: BrowserProductionAudioGraph | null = null;
  private readonly runtimes = new Map<string, ProductionInstrumentRuntime>();
  private scheduledEventIds: number[] = [];
  private readonly subscriptions = new Set<ReturnType<typeof setInterval>>();

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

  loadProject(project: MusicProject): void {
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

    this.rebuildAudioGraph(project);
  }

  private rebuildAudioGraph(project: MusicProject): void {
    const graph = this.ensureGraph();
    this.clearScheduledEvents();
    this.disposeRuntimes();
    const beatsPerBar = project.timeSignatureMap[0]?.numerator ?? 4;
    const ppq = project.transport.ticksPerQuarterNote;

    for (const track of project.tracks) {
      if (track.kind !== "instrument") continue;
      const runtime = graph.createInstrument(track);
      runtime.channel.mute = !trackAudible(track, project.tracks);
      this.runtimes.set(track.id, runtime);

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
    const runtime = this.runtimes.get(trackId);
    if (!runtime) throw new Error(`Track runtime ${trackId} is not available for audition.`);
    runtime.synth.triggerAttackRelease(
      Tone.Frequency(clampMidiValue(Math.round(pitch), 0, 127), "midi").toFrequency(),
      clampMidiValue(durationSeconds, 0.03, 2),
      undefined,
      clampMidiValue(velocity, 1, 127) / 127
    );
  }

  allNotesOff(): void { for (const runtime of this.runtimes.values()) runtime.synth.releaseAll(); }

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
    for (const runtime of this.runtimes.values()) runtime.dispose();
    this.runtimes.clear();
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
    this.initialized = false;
  }
}
