import {
  kernelWasmBytes,
  noteSeed,
  onePoleAlpha,
  OSCILLATOR_CODES,
  VOICE_PROCESSOR_NAME,
  VOICE_PROCESSOR_SOURCE,
  type VoiceProcessorMessage
} from "@synaptix/dsp-kernel";
import * as Tone from "tone";

import { instrumentModulation, type EffectiveInstrumentSettings } from "./production-audio.ts";

const loadedContexts = new WeakMap<Tone.BaseContext, Promise<void>>();
let wasm: Uint8Array | undefined;

/** Loads the kernel's AudioWorklet module into the context, once. */
export function loadKernelWorklet(context: Tone.BaseContext = Tone.getContext()): Promise<void> {
  let loading = loadedContexts.get(context);
  if (!loading) {
    const worklet = context.rawContext.audioWorklet;
    if (!worklet) return Promise.reject(new Error("AudioWorklet requires a secure context (https or localhost)."));
    const url = URL.createObjectURL(new Blob([VOICE_PROCESSOR_SOURCE], { type: "text/javascript" }));
    loading = worklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    loadedContexts.set(context, loading);
  }
  return loading;
}

/**
 * A track's instrument in the studio preview, played by the same Rust kernel as exports (in an
 * AudioWorklet), so a note sounds the same in both. It includes the one-pole filter and the
 * envelope; `output` is stereo (most voices are the same on both sides) and goes to the track's
 * inserts, pan stage and channel strip.
 */
export class KernelInstrument {
  readonly output = new Tone.Gain(1);
  private node: AudioWorkletNode | null = null;
  // Notes sent before the worklet module has loaded (it loads in the background).
  private pending: VoiceProcessorMessage[] = [];
  private disposed = false;

  constructor(private readonly settings: EffectiveInstrumentSettings) {
    const context = Tone.getContext();
    loadKernelWorklet(context).then(
      () => {
        if (this.disposed) return;
        wasm ??= kernelWasmBytes();
        const node = context.createAudioWorkletNode(VOICE_PROCESSOR_NAME, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { wasm }
        });
        Tone.connect(node, this.output);
        for (const message of this.pending) node.port.postMessage(message);
        this.pending = [];
        this.node = node;
      },
      (error: unknown) => console.error("The synthesis kernel could not load; instruments are silent.", error)
    );
  }

  /** `noteId` seeds the plucked string's noise; pass the note's id so it matches exports. */
  triggerAttackRelease(
    frequency: number,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity = 1,
    noteId = ""
  ): void {
    const { settings } = this;
    this.send({
      type: "note",
      oscillator: OSCILLATOR_CODES[settings.oscillator],
      frequency,
      alpha: onePoleAlpha(settings.filterFrequency, Tone.getContext().sampleRate),
      attack: settings.attack,
      decay: settings.decay,
      sustain: settings.sustain,
      release: settings.release,
      noteDuration: Tone.Time(duration).toSeconds(),
      velocityGain: velocity,
      seed: noteSeed(noteId),
      cutoff: settings.filterFrequency,
      resonance: settings.resonance,
      modulation: instrumentModulation(settings),
      time: time === undefined ? Tone.now() : Tone.Time(time).toSeconds()
    });
  }

  /** Note off for every sounding note, now. */
  releaseAll(): void {
    this.send({ type: "release" });
  }

  dispose(): void {
    this.disposed = true;
    this.node?.disconnect();
    this.node?.port.close();
    this.output.dispose();
  }

  private send(message: VoiceProcessorMessage): void {
    if (this.node) this.node.port.postMessage(message);
    else this.pending.push(message);
  }
}
