import { defaultMixer, type MusicProject, type Track } from "@synaptix/project-model";
import * as Tone from "tone";

import {
  meterSnapshot,
  resolveEffectiveInstrumentSettings,
  resolveTrackOutput,
  resolveTrackSend,
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
  private readonly musicBus = new Tone.Channel(0);
  private readonly drumsBus = new Tone.Channel(0);
  private readonly reverb = new Tone.Reverb({ decay: 1.8, wet: 1 });
  private readonly compressor = new Tone.Compressor({ threshold: -10, ratio: 3, attack: 0.01, release: 0.15 });
  private readonly reverbReturn = new Tone.Channel(0);
  private readonly master = new Tone.Channel(0);
  private readonly meters = new Map<string, { peak: Tone.Waveform; rms: Tone.Meter }>();
  private readonly runtimes = new Set<ProductionInstrumentRuntime>();
  private readonly droneRuntimes = new Set<FrequencyDroneRuntime>();
  private readonly meterTimers = new Set<ReturnType<typeof setInterval>>();
  private readonly auditionVoices = new Map<ReturnType<typeof setTimeout>, () => void>();

  constructor() {
    this.musicBus.connect(this.compressor);
    this.drumsBus.connect(this.compressor);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.compressor);
    this.compressor.connect(this.master);
    this.master.toDestination();
    this.addMeter("bus:music", this.musicBus);
    this.addMeter("bus:drums", this.drumsBus);
    this.addMeter("bus:reverb", this.reverbReturn);
    this.addMeter("master", this.master);
  }


  configure(project: MusicProject): void {
    const mixer = project.mixer ?? defaultMixer();
    for (const [id, channel] of Object.entries({ music: this.musicBus, drums: this.drumsBus, reverb: this.reverbReturn, master: this.master })) {
      const settings = mixer[id as keyof typeof mixer];
      channel.volume.value = settings.volumeDb;
      channel.mute = settings.muted;
    }
  }

  private destination(track: Track) {
    const output = resolveTrackOutput(track);
    return output === "music" ? this.musicBus : output === "drums" ? this.drumsBus : this.compressor;
  }

  private addMeter(id: string, channel: Tone.Channel): void {
    this.removeMeter(id);
    const peak = new Tone.Waveform(2048);
    const rms = new Tone.Meter({ smoothing: 0.7, normalRange: false });
    channel.connect(peak); channel.connect(rms);
    this.meters.set(id, { peak, rms });
  }
  private removeMeter(id: string): void {
    const meter = this.meters.get(id);
    meter?.peak.dispose(); meter?.rms.dispose(); this.meters.delete(id);
  }
  channelMeters(): Record<string, MasterMeterSnapshot> {
    return Object.fromEntries([...this.meters].map(([id, meter]) => {
      let peak = 0;
      for (const sample of meter.peak.getValue()) peak = Math.max(peak, Math.abs(sample));
      return [id, meterSnapshot(peak > 0 ? 20 * Math.log10(peak) : -Infinity, meter.rms.getValue())];
    }));
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
    const reverbSend = new Tone.Gain(resolveTrackSend(track));
    channel.connect(reverbSend);
    reverbSend.connect(this.reverb);
    this.addMeter(`track:${track.id}`, channel);
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
        this.removeMeter(`track:${track.id}`); reverbSend.dispose();
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
    const reverbSend = new Tone.Gain(resolveTrackSend(track));

    synth.connect(filter);
    filter.connect(channel);
    channel.connect(this.destination(track));
    this.addMeter(`track:${track.id}`, channel);
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
        this.removeMeter(`track:${track.id}`);
        synth.dispose();
        filter.dispose();
        channel.dispose();
        reverbSend.dispose();
      }
    };
    this.runtimes.add(runtime);
    return runtime;
  }

  /**
   * Plays one preview note through a short-lived voice with the track's sound.
   * It is independent of the track runtimes, which are rebuilt after every
   * edit, so a preview triggered alongside an edit is never cut off.
   */
  auditionNote(track: Track, frequency: number, durationSeconds: number, velocity: number): void {
    const settings = resolveEffectiveInstrumentSettings(track);
    const channel = new Tone.Channel({ volume: track.volumeDb, pan: track.pan });
    const filter = new Tone.Filter(settings.filterFrequency, "lowpass");
    const synth = new Tone.Synth({
      oscillator: { type: settings.oscillator },
      envelope: {
        attack: settings.attack,
        decay: settings.decay,
        sustain: settings.sustain,
        release: settings.release
      }
    });
    synth.connect(filter);
    filter.connect(channel);
    channel.connect(this.destination(track));
    synth.triggerAttackRelease(frequency, durationSeconds, undefined, velocity);

    const release = () => {
      synth.dispose();
      filter.dispose();
      channel.dispose();
    };
    const timer = setTimeout(() => {
      this.auditionVoices.delete(timer);
      release();
    }, (durationSeconds + settings.release + 0.25) * 1000);
    this.auditionVoices.set(timer, release);
  }

  /** Silences every preview voice immediately (panic). */
  stopAuditions(): void {
    for (const [timer, release] of this.auditionVoices) {
      clearTimeout(timer);
      release();
    }
    this.auditionVoices.clear();
  }

  meter(): MasterMeterSnapshot {
    if (this.runtimes.size === 0 && this.droneRuntimes.size === 0) return SILENT_METER;
    return this.channelMeters().master ?? SILENT_METER;
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
    this.stopAuditions();
    for (const timer of this.meterTimers) clearInterval(timer);
    this.meterTimers.clear();
    this.clearTracks();
    this.reverb.dispose();
    this.compressor.dispose();
    for (const id of [...this.meters.keys()]) this.removeMeter(id);
    this.reverbReturn.dispose(); this.master.dispose();
    this.musicBus.dispose();
    this.drumsBus.dispose();
  }

  clearTracks(): void {
    for (const runtime of [...this.runtimes]) runtime.dispose();
    for (const runtime of [...this.droneRuntimes]) runtime.dispose();
  }
}
