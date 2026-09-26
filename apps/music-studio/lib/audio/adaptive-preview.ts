import {
  findAdaptiveTransition,
  planAdaptiveTransition,
  selectAdaptiveState,
  type AdaptiveGameAudioManifest,
  type AdaptiveMusicState,
  type TransitionClock
} from "@synaptix/render-contracts";
type Voice = {
  state: AdaptiveMusicState;
  started: number;
  offset: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
};

/** Browser-only audition graph. All transition timing uses the AudioContext clock. */
export class AdaptivePreview {
  private voices = new Set<{ source: AudioBufferSourceNode; gain: GainNode }>();
  private current: Voice | null = null;
  private outgoing: Voice | null = null;
  private pendingUntil = 0;
  private origin = 0;
  constructor(
    private context: AudioContext,
    private manifest: AdaptiveGameAudioManifest,
    private buffers: Map<string, AudioBuffer>,
    private clock: TransitionClock
  ) {}
  private voice(state: AdaptiveMusicState, when: number, fade: number) {
    const buffer = this.buffers.get(state.masterArtifactId);
    if (!buffer || buffer.duration + 0.05 < state.loopEndSeconds)
      throw new Error("Preview audio is missing or shorter than its loop.");
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = state.loopStartSeconds;
    source.loopEnd = state.loopEndSeconds;
    source.connect(gain);
    gain.connect(this.context.destination);
    gain.gain.setValueAtTime(fade ? 0 : 0.7, when);
    if (fade) gain.gain.linearRampToValueAtTime(0.7, when + fade);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
    };
    source.start(when, state.entryCueSeconds);
    return { ...voice, state, started: when, offset: state.entryCueSeconds };
  }
  async play() {
    await this.context.resume();
    this.stop();
    this.origin = this.context.currentTime;
    this.current = this.voice(
      this.manifest.states.find((state) => state.stateId === this.manifest.defaultStateId)!,
      this.origin,
      0
    );
  }
  private get audible() {
    return this.current && this.context.currentTime < this.current.started
      ? this.outgoing
      : this.current;
  }
  get stateId() {
    return this.audible?.state.stateId ?? null;
  }
  get position() {
    const voice = this.audible;
    if (!voice) return 0;
    const state = voice.state;
    const raw = Math.max(0, this.context.currentTime - voice.started) + voice.offset;
    return raw < state.loopEndSeconds
      ? raw
      : state.loopStartSeconds +
          ((raw - state.loopStartSeconds) % (state.loopEndSeconds - state.loopStartSeconds));
  }
  requestIntensity(intensity: number) {
    return this.requestState(selectAdaptiveState(this.manifest, intensity).stateId);
  }
  requestState(stateId: string) {
    if (!this.current) throw new Error("Start preview playback first.");
    const now = this.context.currentTime;
    if (now < this.pendingUntil)
      throw new Error("Wait for the scheduled transition to finish, or stop playback.");
    if (stateId === this.current.state.stateId) return "Already in the requested state.";
    const transition = findAdaptiveTransition(this.manifest, this.current.state.stateId, stateId);
    if (!transition) throw new Error("No transition is configured between these states.");
    const elapsed = (now - this.current.started) * 1000;
    const cue = this.manifest.cuePoints.find((item) => item.cuePointId === transition.cuePointId);
    let cueAt: number | undefined;
    if (cue) {
      let delay = cue.positionSeconds - this.position;
      if (delay < 0 && cue.positionSeconds >= this.current.state.loopStartSeconds)
        delay += this.current.state.loopEndSeconds - this.current.state.loopStartSeconds;
      if (delay < 0) throw new Error("This cue has already passed and is outside the loop.");
      const minimum = Math.max(0, transition.minimumSourcePlaybackSeconds - elapsed / 1000);
      if (delay < minimum)
        delay +=
          Math.ceil(
            (minimum - delay) /
              (this.current.state.loopEndSeconds - this.current.state.loopStartSeconds)
          ) *
          (this.current.state.loopEndSeconds - this.current.state.loopStartSeconds);
      cueAt = elapsed + delay * 1000;
    }
    const exit = this.current.state.exitCueSeconds;
    let minimumSourcePlaybackSeconds = transition.minimumSourcePlaybackSeconds;
    if (exit !== null) {
      let delay = exit - this.position;
      if (delay < 0 && exit >= this.current.state.loopStartSeconds)
        delay += this.current.state.loopEndSeconds - this.current.state.loopStartSeconds;
      minimumSourcePlaybackSeconds = Math.max(
        minimumSourcePlaybackSeconds,
        elapsed / 1000 + Math.max(0, delay)
      );
    }
    if (cueAt !== undefined && cueAt < minimumSourcePlaybackSeconds * 1000)
      cueAt +=
        Math.ceil(
          (minimumSourcePlaybackSeconds * 1000 - cueAt) /
            ((this.current.state.loopEndSeconds - this.current.state.loopStartSeconds) * 1000)
        ) *
        (this.current.state.loopEndSeconds - this.current.state.loopStartSeconds) *
        1000;
    const plan = planAdaptiveTransition(
      { ...transition, minimumSourcePlaybackSeconds },
      (now - this.origin) * 1000,
      elapsed,
      this.clock,
      cueAt
    );
    const when = now + plan.delayMilliseconds / 1000;
    const fade = transition.crossfadeMilliseconds / 1000;
    const next = this.voice(
      this.manifest.states.find((state) => state.stateId === stateId)!,
      when,
      fade
    );
    this.current.gain.gain.setValueAtTime(0.7, when);
    this.current.gain.gain.linearRampToValueAtTime(0, when + fade);
    this.current.source.stop(when + fade);
    this.outgoing = this.current;
    this.current = next;
    this.pendingUntil = when + fade;
    return `${transition.fromStateId} → ${stateId} in ${plan.delayMilliseconds} ms; ${transition.crossfadeMilliseconds} ms crossfade.`;
  }
  triggerStinger(artifactId: string) {
    if (!this.current) throw new Error("Start preview playback first.");
    const buffer = this.buffers.get(artifactId);
    if (!buffer) throw new Error("Stinger audio is not loaded.");
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.25;
    source.connect(gain);
    gain.connect(this.context.destination);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
    };
    source.start();
    return "Triggered a one-shot stinger at −12 dB.";
  }
  stop() {
    for (const voice of this.voices) {
      try {
        voice.source.stop();
      } catch {}
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
    this.current = null;
    this.outgoing = null;
    this.pendingUntil = 0;
  }
  async dispose() {
    this.stop();
    await this.context.close();
  }
}
