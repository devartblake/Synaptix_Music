import * as Tone from "tone";
export class BrowserAudioEngine { async play(): Promise<void> { await Tone.start(); Tone.getTransport().start(); } pause(): void { Tone.getTransport().pause(); } dispose(): void { Tone.getTransport().stop(); } }
