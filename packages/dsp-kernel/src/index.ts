/**
 * The Rust synthesis kernel (`crates/dsp`, built by `crates/wasm-bindings` into
 * `synaptix-dsp.wasm`). The same module renders exports in the render worker and (next) the
 * studio preview, so both make the same samples. Rebuild the .wasm with `npm run build:wasm -w
 * @synaptix/dsp-kernel` after changing the crates; CI fails if the checked-in file is stale.
 */

export const OSCILLATOR_CODES = { sine: 0, square: 1, sawtooth: 2, triangle: 3 } as const;
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
}

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
    noteStart: number,
    noteTotal: number
  ): number;
}

/** Renders one mono track at a time: begin it, add voices, then read the samples. */
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
      noteStart,
      noteTotal
    );
  }

  /** A copy of the current track's samples. */
  trackSamples(): Float64Array {
    const { address, length } = this.#track;
    return new Float64Array(this.#exports.memory.buffer, address, length).slice();
  }
}
