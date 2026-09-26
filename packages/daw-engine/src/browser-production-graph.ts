import type { Track } from "@synaptix/project-model";
import * as Tone from "tone";

import {
  meterSnapshot,
  resolveEffectiveInstrumentSettings,
  SILENT_METER,
  type MasterMeterSnapshot
} from "./production-audio.ts";
import { FREQUENCY_DRONE_DEVICE_TYPE, resolveFrequencyDroneDevice } from "./frequency-drone.ts";

/** A plug-in insert's audio endpoints (see BrowserPluginInstance). */
export interface PluginInsertNodes {
  readonly input: AudioNode;
  readonly output: AudioNode;
}

export interface ProductionInstrumentRuntime {
  synth: Tone.PolySynth;
  filter: Tone.Filter;
  channel: Tone.Channel;
  reverbSend: Tone.Gain;
  /** Route the post-filter signal through plug-in inserts, in order, before the channel strip. */
  setInserts(inserts: readonly PluginInsertNodes[]): void;
  dispose(): void;
}

export interface FrequencyDroneRuntime {
  oscillators: Tone.Oscillator[];
  filter: Tone.Filter;
  gain: Tone.Gain;
  channel: Tone.Channel;
  lfo: Tone.LFO | null;
  setInserts(inserts: readonly PluginInsertNodes[]): void;
  dispose(): void;
}

function routeInserts(
  source: Tone.ToneAudioNode,
  destination: Tone.ToneAudioNode,
  previous: readonly PluginInsertNodes[],
  inserts: readonly PluginInsertNodes[]
): void {
  source.disconnect();
  // Reused instances may still be wired into a previous graph; start every insert clean.
  for (const insert of [...previous, ...inserts]) insert.output.disconnect();
  let tail: Tone.ToneAudioNode | AudioNode = source;
  for (const insert of inserts) {
    Tone.connect(tail, insert.input);
    tail = insert.output;
  }
  Tone.connect(tail, destination);
}

export type MasterMeterListener = (snapshot: MasterMeterSnapshot) => void;

export class BrowserProductionAudioGraph {
  private readonly musicBus = new Tone.Gain(1);
  private readonly drumsBus = new Tone.Gain(1);
  private readonly reverb = new Tone.Reverb({ decay: 1.8, wet: 1 });
  private readonly compressor = new Tone.Compressor({ threshold: -10, ratio: 3, attack: 0.01, release: 0.15 });
  private readonly peakMeter = new Tone.Meter({ smoothing: 0.05, normalRange: false });
  private readonly rmsMeter = new Tone.Meter({ smoothing: 0.85, normalRange: false });
  private readonly runtimes = new Set<ProductionInstrumentRuntime>();
  private readonly droneRuntimes = new Set<FrequencyDroneRuntime>();
  private readonly meterTimers = new Set<ReturnType<typeof setInterval>>();

  constructor() {
    this.musicBus.connect(this.compressor);
    this.drumsBus.connect(this.compressor);
    this.reverb.connect(this.compressor);
    this.compressor.connect(this.peakMeter);
    this.peakMeter.connect(this.rmsMeter);
    this.rmsMeter.toDestination();
  }


  createFrequencyDrone(track: Track): FrequencyDroneRuntime | null {
    const device = track.devices.find((candidate) => candidate.deviceType === FREQUENCY_DRONE_DEVICE_TYPE && candidate.enabled);
    if (!device) return null;
    const settings = resolveFrequencyDroneDevice(device);
    const channel = new Tone.Channel({ volume: track.volumeDb, pan: track.pan, mute: track.muted });
    const filter = new Tone.Filter(settings.filterHz, "lowpass");
    const gain = new Tone.Gain(settings.gain);
    const oscillators: Tone.Oscillator[] = [];
    const count = Math.max(1, Math.min(8, settings.harmonics));
    for (let harmonic = 1; harmonic <= count; harmonic += 1) {
      const oscillator = new Tone.Oscillator({
        frequency: settings.frequencyHz * harmonic,
        type: "sine",
        volume: -12 * Math.log2(harmonic)
      });
      oscillator.connect(gain);
      oscillator.start();
      oscillators.push(oscillator);
    }
    let lfo: Tone.LFO | null = null;
    if (settings.modulationDepth > 0 && settings.modulationRateHz > 0) {
      const base = settings.gain;
      lfo = new Tone.LFO(settings.modulationRateHz, base * (1 - settings.modulationDepth), base).start();
      lfo.connect(gain.gain);
    }
    gain.connect(filter);
    filter.connect(channel);
    channel.connect(this.musicBus);
    let inserts: readonly PluginInsertNodes[] = [];
    const runtime: FrequencyDroneRuntime = {
      oscillators, filter, gain, channel, lfo,
      setInserts: (next) => {
        routeInserts(filter, channel, inserts, next);
        inserts = [...next];
      },
      dispose: () => {
        this.droneRuntimes.delete(runtime);
        for (const oscillator of oscillators) oscillator.dispose();
        lfo?.dispose(); filter.dispose(); gain.dispose(); channel.dispose();
      }
    };
    this.droneRuntimes.add(runtime);
    return runtime;
  }

  createInstrument(track: Track): ProductionInstrumentRuntime {
    const settings = resolveEffectiveInstrumentSettings(track);
    const channel = new Tone.Channel({ volume: track.volumeDb, pan: track.pan, mute: track.muted });
    const filter = new Tone.Filter(settings.filterFrequency, "lowpass");
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: settings.oscillator },
      envelope: {
        attack: settings.attack,
        decay: settings.decay,
        sustain: settings.sustain,
        release: settings.release
      }
    });
    const reverbSend = new Tone.Gain(settings.reverbSend);

    synth.connect(filter);
    filter.connect(channel);
    channel.connect(settings.destinationBus === "drums" ? this.drumsBus : this.musicBus);
    channel.connect(reverbSend);
    reverbSend.connect(this.reverb);

    let inserts: readonly PluginInsertNodes[] = [];
    const runtime: ProductionInstrumentRuntime = {
      synth,
      filter,
      channel,
      reverbSend,
      setInserts: (next) => {
        routeInserts(filter, channel, inserts, next);
        inserts = [...next];
      },
      dispose: () => {
        this.runtimes.delete(runtime);
        synth.dispose();
        filter.dispose();
        channel.dispose();
        reverbSend.dispose();
      }
    };
    this.runtimes.add(runtime);
    return runtime;
  }

  meter(): MasterMeterSnapshot {
    if (this.runtimes.size === 0 && this.droneRuntimes.size === 0) return SILENT_METER;
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
    for (const runtime of [...this.droneRuntimes]) runtime.dispose();
    this.reverb.dispose();
    this.compressor.dispose();
    this.peakMeter.dispose();
    this.rmsMeter.dispose();
    this.musicBus.dispose();
    this.drumsBus.dispose();
  }
}
