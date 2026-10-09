/**
 * The Rust synthesis kernel (`crates/dsp`, built by `crates/wasm-bindings` and embedded in
 * `kernel-wasm.ts`). The same module renders exports in the render worker and plays notes in the
 * studio preview's AudioWorklet (`voice-processor.ts`), so both make the same samples. Rebuild
 * it with `npm run build:wasm -w @synaptix/dsp-kernel` after changing the crates; CI fails if
 * the checked-in module is stale.
 */
import { KERNEL_WASM_BASE64 } from "./kernel-wasm.ts";

export {
  VOICE_PROCESSOR_NAME,
  VOICE_PROCESSOR_SOURCE,
  type VoiceProcessorMessage
} from "./voice-processor.ts";

/** The kernel's WebAssembly bytes. */
export function kernelWasmBytes(): Uint8Array<ArrayBuffer> {
  const binary = atob(KERNEL_WASM_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A note's noise seed, from its id (FNV-1a), so the studio preview and every export of the same
 * project pluck the same string. Render seeds are per render request, which the preview never
 * sees.
 */
export function noteSeed(noteId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < noteId.length; i++) hash = Math.imul(hash ^ noteId.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** The one-pole low-pass coefficient for a cutoff, shared by exports and preview. */
export function onePoleAlpha(filterFrequency: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * filterFrequency) / sampleRate);
}

export const OSCILLATOR_CODES = {
  sine: 0,
  square: 1,
  sawtooth: 2,
  triangle: 3,
  supersaw: 4,
  "plucked-string": 5,
  "fm-bell": 6,
  "fm-piano": 7,
  "drum-kit": 8,
  "808-bass": 9,
  "pulse-25": 10,
  noise: 11,
  "fm-marimba": 12,
  "fm-vibraphone": 13
} as const;
export type KernelOscillator = keyof typeof OSCILLATOR_CODES;

export interface VoiceParams {
  oscillator: KernelOscillator;
  frequency: number;
  sampleRate: number;
  /** One-pole low-pass coefficient. */
  alpha: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Seconds from note start to note off; the release follows. */
  noteDuration: number;
  velocityGain: number;
  /** Seeds the plucked string's noise burst; see noteSeed. */
  seed: number;
  /** Cutoff in Hz, used by the resonant filter. */
  cutoff: number;
  /** 0 keeps the one-pole low-pass (`alpha`); above 0 a 12 dB resonant low-pass at `cutoff`. */
  resonance: number;
  /** Omitted or all zero: no modulation, exactly as before. */
  modulation?: VoiceModulation;
}

/** One sine LFO to pitch, cutoff and level, and a filter envelope (crates/dsp `Modulation`). */
export interface VoiceModulation {
  /** LFO speed in Hz. */
  lfoRate: number;
  /** Pitch swings ± this many cents. */
  vibratoCents: number;
  /** Cutoff swings ± this many octaves. */
  lfoCutoffOctaves: number;
  /** Level dips by up to this much, 0–1. */
  tremolo: number;
  /** The cutoff starts this many octaves higher and decays onto it. */
  filterEnvOctaves: number;
  /** Seconds for the filter envelope to fall to a quarter. */
  filterEnvDecay: number;
}

export const NO_MODULATION: VoiceModulation = {
  lfoRate: 0,
  vibratoCents: 0,
  lfoCutoffOctaves: 0,
  tremolo: 0,
  filterEnvOctaves: 0,
  filterEnvDecay: 0
};

interface KernelExports {
  memory: WebAssembly.Memory;
  begin_track(length: number): number;
  render_voice(
    oscillator: number,
    frequency: number,
    sampleRate: number,
    alpha: number,
    attack: number,
    decay: number,
    sustain: number,
    release: number,
    noteDuration: number,
    velocityGain: number,
    seed: number,
    cutoff: number,
    resonance: number,
    lfoRate: number,
    vibratoCents: number,
    lfoCutoffOctaves: number,
    tremolo: number,
    filterEnvOctaves: number,
    filterEnvDecay: number,
    noteStart: number,
    noteTotal: number
  ): number;
}

function modulationArguments(m: VoiceModulation): [number, number, number, number, number, number] {
  return [
    m.lfoRate,
    m.vibratoCents,
    m.lfoCutoffOctaves,
    m.tremolo,
    m.filterEnvOctaves,
    m.filterEnvDecay
  ];
}

/** Renders one stereo track at a time: begin it, add voices, then read the samples. */
export class DspKernel {
  readonly #exports: KernelExports;
  #track = { address: 0, length: 0 };

  constructor(module: WebAssembly.Module) {
    this.#exports = new WebAssembly.Instance(module).exports as unknown as KernelExports;
  }

  beginTrack(length: number): void {
    this.#track = { address: this.#exports.begin_track(length), length };
  }

  /** Adds a note starting at `noteStart` (may be negative) lasting `noteTotal` samples. */
  renderVoice(params: VoiceParams, noteStart: number, noteTotal: number): void {
    this.#exports.render_voice(
      OSCILLATOR_CODES[params.oscillator],
      params.frequency,
      params.sampleRate,
      params.alpha,
      params.attack,
      params.decay,
      params.sustain,
      params.release,
      params.noteDuration,
      params.velocityGain,
      params.seed,
      params.cutoff,
      params.resonance,
      ...modulationArguments(params.modulation ?? NO_MODULATION),
      noteStart,
      noteTotal
    );
  }

  /** A copy of the current track's samples (mono voices are identical on both sides). */
  trackSamples(): { left: Float64Array; right: Float64Array } {
    const { address, length } = this.#track;
    const { buffer } = this.#exports.memory;
    return {
      left: new Float64Array(buffer, address, length).slice(),
      right: new Float64Array(buffer, address + 8 * length, length).slice()
    };
  }
}
