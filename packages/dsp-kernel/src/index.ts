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

/** The one-pole low-pass coefficient for a cutoff, shared by exports and preview. */
export function onePoleAlpha(filterFrequency: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * filterFrequency) / sampleRate);
}

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
