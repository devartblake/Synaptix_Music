import type { MusicProject, MusicalPosition, Track } from "@synaptix/project-model";
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

interface TrackRuntime {
  channel: Tone.Channel;
  synth: Tone.PolySynth;
}

function positionToTicks(position: MusicalPosition, beatsPerBar = 4, ppq = 960): number {
  return position.bar * beatsPerBar * ppq + position.beat * ppq + position.tick;
}

function trackAudible(track: Track, tracks: readonly Track[]): boolean {
  const anySolo = tracks.some((candidate) => candidate.solo);
  return !track.muted && (!anySolo || track.solo);
}

export class BrowserAudioEngine implements AudioTransport {
  private initialized = false;
  private project: MusicProject | null = null;
  private readonly runtimes = new Map<string, TrackRuntime>();
  private scheduledEventIds: number[] = [];

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

    this.rebuildAudioGraph(project);
  }

  private rebuildAudioGraph(project: MusicProject): void {
    this.clearScheduledEvents();
    this.disposeRuntimes();

    const beatsPerBar = project.timeSignatureMap[0]?.numerator ?? 4;
    const ppq = project.transport.ticksPerQuarterNote;

    for (const track of project.tracks) {
      if (track.kind !== "instrument") continue;

      const channel = new Tone.Channel({
        volume: track.volumeDb,
        pan: track.pan,
        mute: !trackAudible(track, project.tracks)
      }).toDestination();
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: track.name.toLowerCase().includes("bass") ? "square" : "triangle" },
        envelope: { attack: 0.01, decay: 0.12, sustain: 0.35, release: 0.2 }
      }).connect(channel);

      this.runtimes.set(track.id, { channel, synth });

      for (const clip of track.clips) {
        if (clip.kind !== "midi") continue;
        const clipStartTicks = positionToTicks(clip.range.start, beatsPerBar, ppq);
        for (const note of clip.notes) {
          const eventId = Tone.getTransport().schedule((time) => {
            synth.triggerAttackRelease(
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

  private clearScheduledEvents(): void {
    const transport = Tone.getTransport();
    for (const eventId of this.scheduledEventIds) {
      transport.clear(eventId);
    }
    this.scheduledEventIds = [];
  }

  private disposeRuntimes(): void {
    for (const runtime of this.runtimes.values()) {
      runtime.synth.dispose();
      runtime.channel.dispose();
    }
    this.runtimes.clear();
  }

  dispose(): void {
    this.stop();
    this.clearScheduledEvents();
    this.disposeRuntimes();
    this.project = null;
    this.initialized = false;
  }
}
