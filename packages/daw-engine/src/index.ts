import type { MusicProject, MusicalPosition } from "@synaptix/project-model";
import * as Tone from "tone";

export interface TransportSnapshot {
  initialized: boolean;
  playing: boolean;
  positionSeconds: number;
  tempo: number;
  loopEnabled: boolean;
}

export interface AudioTransport {
  initialize(): Promise<void>;
  loadProject(project: MusicProject): void;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(position: MusicalPosition): void;
  setLoop(enabled: boolean): void;
  snapshot(): TransportSnapshot;
  dispose(): void;
}

function positionToTicks(position: MusicalPosition, beatsPerBar = 4, ppq = 960): number {
  return position.bar * beatsPerBar * ppq + position.beat * ppq + position.tick;
}

export class BrowserAudioEngine implements AudioTransport {
  private initialized = false;
  private project: MusicProject | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();
    this.initialized = true;
  }

  loadProject(project: MusicProject): void {
    this.project = structuredClone(project);
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
  }

  async play(): Promise<void> {
    await this.initialize();
    Tone.getTransport().start();
  }

  pause(): void {
    Tone.getTransport().pause();
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    transport.seconds = 0;
  }

  seek(position: MusicalPosition): void {
    if (!this.project) {
      throw new Error("A project must be loaded before seeking.");
    }
    const ticks = positionToTicks(
      position,
      this.project.timeSignatureMap[0]?.numerator ?? 4,
      this.project.transport.ticksPerQuarterNote
    );
    Tone.getTransport().ticks = ticks;
  }

  setLoop(enabled: boolean): void {
    Tone.getTransport().loop = enabled;
  }

  snapshot(): TransportSnapshot {
    const transport = Tone.getTransport();
    return {
      initialized: this.initialized,
      playing: transport.state === "started",
      positionSeconds: transport.seconds,
      tempo: transport.bpm.value,
      loopEnabled: Boolean(transport.loop)
    };
  }

  dispose(): void {
    this.stop();
    this.project = null;
    this.initialized = false;
  }
}
