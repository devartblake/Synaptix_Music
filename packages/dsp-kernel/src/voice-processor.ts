/**
 * The studio preview's AudioWorklet processor: plays notes through the kernel in real time.
 *
 * It is plain JavaScript in a string because worklet modules load from a URL (the studio uses a
 * Blob URL) and can't import. The kernel's bytes arrive in `processorOptions.wasm` and are
 * compiled here, off the main thread. One node plays one track, mono; the track's channel strip
 * pans it, as in exports. Rendering in 128-frame blocks makes exactly the samples an export
 * makes (see voice-processor.test.ts).
 */

export const VOICE_PROCESSOR_NAME = "synaptix-kernel-voice";

export type VoiceProcessorMessage =
  | {
      type: "note";
      /** OSCILLATOR_CODES value. */
      oscillator: number;
      frequency: number;
      alpha: number;
      attack: number;
      decay: number;
      sustain: number;
      release: number;
      noteDuration: number;
      velocityGain: number;
      seed: number;
      /** AudioContext time the note starts. */
      time: number;
    }
  /** Note off for every sounding note at `time` (now if omitted). */
  | { type: "release"; time?: number };

export const VOICE_PROCESSOR_SOURCE = `
class SynaptixKernelVoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const module = new WebAssembly.Module(options.processorOptions.wasm);
    this.kernel = new WebAssembly.Instance(module).exports;
    this.port.onmessage = (event) => this.receive(event.data);
  }

  receive(message) {
    if (message.type === "note") {
      // Same start and length rounding as the offline renderer.
      this.kernel.start_voice(
        message.oscillator, message.frequency, sampleRate, message.alpha,
        message.attack, message.decay, message.sustain, message.release,
        message.noteDuration, message.velocityGain, message.seed,
        Math.round(message.time * sampleRate),
        Math.round((message.noteDuration + message.release) * sampleRate)
      );
    } else if (message.type === "release") {
      this.kernel.release_voices(message.time === undefined ? currentFrame : Math.round(message.time * sampleRate));
    }
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    const length = channels[0].length;
    const address = this.kernel.render_block(currentFrame, length);
    const block = new Float32Array(this.kernel.memory.buffer, address, length);
    for (const channel of channels) channel.set(block);
    return true;
  }
}

registerProcessor(${JSON.stringify(VOICE_PROCESSOR_NAME)}, SynaptixKernelVoiceProcessor);
`;
