import type { Track } from "@synaptix/project-model";
import * as Tone from "tone";

import {
  meterSnapshot,
  resolveInstrumentProfile,
  SILENT_METER,
  type MasterMeterSnapshot
} from "./production-audio.ts";

export interface ProductionInstrumentRuntime {
  synth: Tone.PolySynth;
  filter: Tone.Filter;
  channel: Tone.Channel;
  dispose(): void;
}

export type MasterMeterListener = (snapshot: MasterMeterSnapshot) => void;

export class BrowserProductionAudioGraph {
  private readonly musicBus = new Tone.Gain(1);
  private readonly drumsBus = new Tone.Gain(1);
  private readonly reverb = new Tone.Reverb({ decay: 1.8, wet: 0.16 });
  private readonly compressor = new Tone.Compressor({ threshold: -10, ratio: 3, attack: 0.01, release: 0.15 });
  private readonly peakMeter = new Tone.Meter({ smoothing: 0.05, normalRange: false });
  private readonly rmsMeter = new Tone.Meter({ smoothing: 0.85, normalRange: false });
  private readonly runtimes = new Set<ProductionInstrumentRuntime>();
  private readonly meterTimers = new Set<ReturnType<typeof setInterval>>();

  constructor() {
    this.musicBus.connect(this.compressor);
    this.drumsBus.connect(this.compressor);
    this.musicBus.connect(this.reverb);
    this.drumsBus.connect(this.reverb);
    this.reverb.connect(this.compressor);
    this.compressor.connect(this.peakMeter);
    this.peakMeter.connect(this.rmsMeter);
    this.rmsMeter.toDestination();
  }

  createInstrument(track: Track): ProductionInstrumentRuntime {
    const profile = resolveInstrumentProfile(track);
    const channel = new Tone.Channel({ volume: track.volumeDb, pan: track.pan, mute: track.muted });
    const filter = new Tone.Filter(profile.filterFrequency, "lowpass");
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: profile.oscillator },
      envelope: {
        attack: profile.attack,
        decay: profile.decay,
        sustain: profile.sustain,
        release: profile.release
      }
    });

    synth.connect(filter);
    filter.connect(channel);
    channel.connect(profile.destinationBus === "drums" ? this.drumsBus : this.musicBus);

    const runtime: ProductionInstrumentRuntime = {
      synth,
      filter,
      channel,
      dispose: () => {
        this.runtimes.delete(runtime);
        synth.dispose();
        filter.dispose();
        channel.dispose();
      }
    };
    this.runtimes.add(runtime);
    return runtime;
  }

  meter(): MasterMeterSnapshot {
    if (this.runtimes.size === 0) return SILENT_METER;
    return meterSnapshot(this.peakMeter.getValue(), this.rmsMeter.getValue());
  }

  subscribeMeter(listener: MasterMeterListener, intervalMs = 50): () => void {
    const safeInterval = Math.max(25, Math.round(intervalMs));
    listener(this.meter());
    const timer = setInterval(() => listener(this.meter()), safeInterval);
    this.meterTimers.add(timer);
    return () => {
      clearInterval(timer);
      this.meterTimers.delete(timer);
    };
  }

  dispose(): void {
    for (const timer of this.meterTimers) clearInterval(timer);
    this.meterTimers.clear();
    for (const runtime of [...this.runtimes]) runtime.dispose();
    this.reverb.dispose();
    this.compressor.dispose();
    this.peakMeter.dispose();
    this.rmsMeter.dispose();
    this.musicBus.dispose();
    this.drumsBus.dispose();
  }
}
