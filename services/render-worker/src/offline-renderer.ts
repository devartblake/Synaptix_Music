import { createHash } from "node:crypto";

import {
  FREQUENCY_DRONE_DEVICE_TYPE,
  buildFrequencyDroneRenderPlan,
  renderFrequencyDroneMono,
  resolveFrequencyDroneDevice,
  resolveEffectiveInstrumentSettings,
  resolveTrackOutput,
  resolveTrackSend,
  type EffectiveInstrumentSettings
} from "@synaptix/daw-engine/production-audio";
import { defaultMixer, type MusicProject, type MusicalPosition, type Track } from "@synaptix/project-model";
import {
  RENDER_CONTRACT_VERSION,
  type RenderArtifact,
  type RenderManifest,
  type RenderResult
} from "@synaptix/render-contracts";

import { projectV2BuiltinView, type MusicProjectV2 } from "@synaptix/project-model/v2";

import { applyCompressor } from "./compressor.ts";
import { offlineProcessorFor, type OfflinePluginProcessor } from "./plugin-processors.ts";
import { PluginRenderUnsupportedError } from "./plugin-render-error.ts";
import { applyReverb } from "./reverb.ts";
import { encodeWav, type StereoBuffer } from "./wav-encoder.ts";

export interface RenderedArtifact {
  metadata: RenderArtifact;
  bytes: Buffer;
}

export interface OfflineRenderOutcome {
  result: RenderResult;
  artifacts: RenderedArtifact[];
}

/**
 * Deterministic offline PCM synthesis, independent of the browser's Tone.js
 * preview graph (see ADR-0003): same canonical device/routing semantics via
 * resolveEffectiveInstrumentSettings, but its own pure-JS oscillator/envelope
 * math so it never depends on a Web Audio implementation. Its deterministic
 * reverb and compressor share the production graph's routing and parameter
 * semantics without claiming sample-for-sample parity with Tone.js.
 */

const MASTER_REVERB_DECAY_SECONDS = 1.8;
const MASTER_COMPRESSOR = {
  thresholdDb: -10,
  ratio: 3,
  attackSeconds: 0.01,
  releaseSeconds: 0.15
} as const;

function midiToFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

export function ticksToSeconds(ticks: number, ppq: number, bpm: number): number {
  return (ticks / ppq) * (60 / bpm);
}

function positionToTicks(position: MusicalPosition, beatsPerBar: number, ppq: number): number {
  return position.bar * beatsPerBar * ppq + position.beat * ppq + position.tick;
}

function trackAudible(track: Track, tracks: readonly Track[]): boolean {
  const anySolo = tracks.some((candidate) => candidate.solo);
  return !track.muted && (!anySolo || track.solo);
}

interface TickRange {
  startTick: number;
  endTick: number;
}

const OSCILLATOR_CODES = { sine: 0, square: 1, sawtooth: 2, triangle: 3 } as const;

/**
 * One note: oscillator -> one-pole low-pass -> ADSR -> velocity, added into the track buffer.
 *
 * This is the renderer's hot loop (docs/development/dsp-profiling.md), so the oscillator and
 * envelope are computed inline (no per-sample calls or table lookups) and the sample range is
 * clipped to the buffer once. The golden-checksum test in offline-renderer.test.ts fails if a
 * change here alters the rendered audio.
 */
function renderVoice(
  left: Float64Array,
  right: Float64Array,
  settings: EffectiveInstrumentSettings,
  noteStartSample: number,
  noteTotalSamples: number,
  totalSamples: number,
  sampleRate: number,
  frequency: number,
  alpha: number,
  noteDurationSeconds: number,
  velocityGain: number
): void {
  const oscillator = OSCILLATOR_CODES[settings.oscillator];
  const { attack, decay, sustain, release } = settings;
  // Samples before the buffer start are skipped without touching the filter, as before.
  const first = Math.max(0, -noteStartSample);
  const end = Math.min(noteTotalSamples, totalSamples - noteStartSample);
  let filtered = 0;
  for (let sampleIndex = first; sampleIndex < end; sampleIndex++) {
    const timeSeconds = sampleIndex / sampleRate;
    const phase = timeSeconds * frequency;
    const cycle = phase - Math.floor(phase);
    const raw =
      oscillator === 0
        ? Math.sin(2 * Math.PI * cycle)
        : oscillator === 1
          ? cycle < 0.5
            ? 1
            : -1
          : oscillator === 2
            ? 2 * cycle - 1
            : cycle < 0.5
              ? 4 * cycle - 1
              : 3 - 4 * cycle;
    filtered += alpha * (raw - filtered);

    let envelope: number;
    if (timeSeconds < attack) envelope = attack > 0 ? timeSeconds / attack : 1;
    else {
      const sinceDecayStart = timeSeconds - attack;
      if (sinceDecayStart < decay)
        envelope = decay > 0 ? 1 - (1 - sustain) * (sinceDecayStart / decay) : sustain;
      else if (timeSeconds < noteDurationSeconds) envelope = sustain;
      else {
        const sinceRelease = timeSeconds - noteDurationSeconds;
        envelope =
          sinceRelease >= release ? 0 : release > 0 ? sustain * (1 - sinceRelease / release) : 0;
      }
    }

    const value = filtered * envelope * velocityGain;
    const target = noteStartSample + sampleIndex;
    left[target]! += value;
    right[target]! += value;
  }
}

function renderTrackBuffer(
  track: Track,
  tracks: readonly Track[],
  range: TickRange,
  totalSamples: number,
  sampleRate: number,
  ppq: number,
  beatsPerBar: number,
  bpm: number,
  forceAudible: boolean,
  /** False stops before the channel strip (volume and pan), where plug-in inserts sit. */
  applyChannel = true
): StereoBuffer {
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);
  if (!forceAudible && !trackAudible(track, tracks)) return { left, right };

  const settings = resolveEffectiveInstrumentSettings(track);
  const alpha = 1 - Math.exp((-2 * Math.PI * settings.filterFrequency) / sampleRate);

  for (const clip of track.clips) {
    if (clip.kind !== "midi") continue;
    const clipStartTicks = positionToTicks(clip.range.start, beatsPerBar, ppq);

    for (const note of clip.notes) {
      const noteStartTicks = clipStartTicks + note.startTick;
      if (noteStartTicks < range.startTick || noteStartTicks >= range.endTick) continue;

      const noteStartSeconds = ticksToSeconds(noteStartTicks - range.startTick, ppq, bpm);
      const noteDurationSeconds = ticksToSeconds(note.durationTicks, ppq, bpm);
      const frequency = midiToFrequency(note.pitch);
      const velocityGain = note.velocity / 127;
      const noteStartSample = Math.round(noteStartSeconds * sampleRate);
      const noteTotalSamples = Math.round((noteDurationSeconds + settings.release) * sampleRate);

      renderVoice(
        left,
        right,
        settings,
        noteStartSample,
        noteTotalSamples,
        totalSamples,
        sampleRate,
        frequency,
        alpha,
        noteDurationSeconds,
        velocityGain
      );
    }
  }

  if (!applyChannel) return { left, right };
  const gainLinear = 10 ** (track.volumeDb / 20);
  const panAngle = ((track.pan + 1) * Math.PI) / 4;
  const leftGain = gainLinear * Math.cos(panAngle);
  const rightGain = gainLinear * Math.sin(panAngle);
  for (let i = 0; i < totalSamples; i++) {
    left[i] = (left[i] ?? 0) * leftGain;
    right[i] = (right[i] ?? 0) * rightGain;
  }

  return { left, right };
}


function renderFrequencyDroneTrackBuffer(
  track: Track, tracks: readonly Track[], totalSamples: number, sampleRate: number,
  durationSeconds: number, forceAudible: boolean
): StereoBuffer | null {
  const device = track.devices.find((candidate) => candidate.deviceType === FREQUENCY_DRONE_DEVICE_TYPE && candidate.enabled);
  if (!device) return null;
  const left = new Float64Array(totalSamples), right = new Float64Array(totalSamples);
  if (!forceAudible && !trackAudible(track, tracks)) return { left, right };
  const settings = resolveFrequencyDroneDevice(device);
  const mono = renderFrequencyDroneMono(buildFrequencyDroneRenderPlan(settings, durationSeconds, sampleRate));
  const gainLinear = 10 ** (track.volumeDb / 20);
  const panAngle = ((track.pan + 1) * Math.PI) / 4;
  const leftGain = gainLinear * Math.cos(panAngle), rightGain = gainLinear * Math.sin(panAngle);
  for (let i=0;i<totalSamples;i++){const sample=mono[i] ?? 0; left[i]=sample*leftGain; right[i]=sample*rightGain;}
  return { left, right };
}

function mixInto(target: StereoBuffer, source: StereoBuffer): void {
  for (let i = 0; i < target.left.length; i++) {
    target.left[i] = (target.left[i] ?? 0) + (source.left[i] ?? 0);
    target.right[i] = (target.right[i] ?? 0) + (source.right[i] ?? 0);
  }
}

function mixIntoScaled(target: StereoBuffer, source: StereoBuffer, gain: number): void {
  for (let i = 0; i < target.left.length; i++) {
    target.left[i] = (target.left[i] ?? 0) + (source.left[i] ?? 0) * gain;
    target.right[i] = (target.right[i] ?? 0) + (source.right[i] ?? 0) * gain;
  }
}

function peakAmplitude(buffer: StereoBuffer): number {
  let peak = 0;
  for (const channel of [buffer.left, buffer.right]) {
    for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i] ?? 0));
  }
  return peak;
}

function applyNormalization(
  buffer: StereoBuffer,
  targetDbfs: number | null,
  warnings: string[],
  label: string
): void {
  if (targetDbfs === null) return;
  const peak = peakAmplitude(buffer);
  if (peak === 0) {
    warnings.push(`Normalization requested for '${label}' but the render is silent.`);
    return;
  }
  const gain = 10 ** (targetDbfs / 20) / peak;
  for (const channel of [buffer.left, buffer.right]) {
    for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] ?? 0) * gain;
  }
}

function clampAndDetectClipping(buffer: StereoBuffer): boolean {
  let clipped = false;
  for (const channel of [buffer.left, buffer.right]) {
    for (let i = 0; i < channel.length; i++) {
      const value = channel[i] ?? 0;
      if (value > 1 || value < -1) clipped = true;
      channel[i] = Math.max(-1, Math.min(1, value));
    }
  }
  return clipped;
}

function slugify(name: string): string {
  const lower = name.toLowerCase();
  const slugChars: string[] = [];
  let previousWasDash = false;

  for (let i = 0; i < lower.length; i++) {
    const char = lower[i]!;
    const isLowerAlpha = char >= "a" && char <= "z";
    const isDigit = char >= "0" && char <= "9";
    if (isLowerAlpha || isDigit) {
      slugChars.push(char);
      previousWasDash = false;
      continue;
    }
    if (!previousWasDash && slugChars.length > 0) {
      slugChars.push("-");
      previousWasDash = true;
    }
  }

  if (slugChars[slugChars.length - 1] === "-") slugChars.pop();
  const slug = slugChars.join("");
  return slug.length > 0 ? slug : "track";
}

function buildArtifact(
  manifest: RenderManifest,
  buffer: StereoBuffer,
  trackId: string | null,
  fileName: string,
  warnings: string[]
): RenderedArtifact {
  applyNormalization(buffer, manifest.output.normalizePeakDbfs, warnings, fileName);
  if (clampAndDetectClipping(buffer))
    warnings.push(`Clipping occurred while rendering '${fileName}'.`);

  const bytes = encodeWav(buffer, manifest.output.sampleRate, manifest.output.bitDepth);
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    metadata: {
      artifactId: crypto.randomUUID(),
      renderId: manifest.renderId,
      trackId,
      fileName,
      mediaType: "audio/wav",
      byteLength: bytes.length,
      checksumSha256,
      durationSeconds: buffer.left.length / manifest.output.sampleRate
    },
    bytes
  };
}

export interface OfflineRenderOptions {
  /**
   * Pre-fader signals that replace a track's synthesized audio (frozen plug-in playback, cutover
   * step F). Volume, pan, mute, solo, routing and sends still apply on top.
   */
  preFader?: ReadonlyMap<string, StereoBuffer>;
}

/** Samples in a mix/stems render of this manifest: the range plus the requested tail. */
export function renderLengthSamples(
  project: Pick<MusicProject, "transport" | "tempoMap">,
  manifest: Pick<RenderManifest, "range" | "output">
): number {
  const bpm = project.tempoMap[0]?.bpm ?? 120;
  const seconds = ticksToSeconds(manifest.range.endTick - manifest.range.startTick, project.transport.ticksPerQuarterNote, bpm);
  return Math.max(1, Math.round((seconds + manifest.output.includeTailSeconds) * manifest.output.sampleRate));
}

/** A copy of a pre-fader signal fitted to the render length, through the track's volume and pan. */
function channelStrip(source: StereoBuffer, track: Track, totalSamples: number): StereoBuffer {
  const gainLinear = 10 ** (track.volumeDb / 20);
  const panAngle = ((track.pan + 1) * Math.PI) / 4;
  const leftGain = gainLinear * Math.cos(panAngle);
  const rightGain = gainLinear * Math.sin(panAngle);
  const left = new Float64Array(totalSamples);
  const right = new Float64Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    left[i] = (source.left[i] ?? 0) * leftGain;
    right[i] = (source.right[i] ?? 0) * rightGain;
  }
  return { left, right };
}

export function renderProjectOffline(
  project: MusicProject,
  manifest: RenderManifest,
  options: OfflineRenderOptions = {}
): OfflineRenderOutcome {
  if (project.projectId !== manifest.projectId) {
    throw new Error(
      `Manifest projectId '${manifest.projectId}' does not match project '${project.projectId}'.`
    );
  }
  if (project.revisionId !== manifest.revisionId) {
    throw new Error(
      `Manifest revisionId '${manifest.revisionId}' does not match project revision '${project.revisionId}'.`
    );
  }
  if (manifest.scope.kind === "plugin-freeze") {
    // Freezes need the v2 project's plug-in devices; see renderPluginFreeze.
    throw new Error("Plug-in freeze renders must use renderPluginFreeze.");
  }

  const ppq = project.transport.ticksPerQuarterNote;
  const beatsPerBar = project.timeSignatureMap[0]?.numerator ?? 4;
  const bpm = project.tempoMap[0]?.bpm ?? 120;
  const sampleRate = manifest.output.sampleRate;
  const range: TickRange = { startTick: manifest.range.startTick, endTick: manifest.range.endTick };

  const totalSamples = renderLengthSamples(project, manifest);

  const instrumentTracks = project.tracks.filter((track) => track.kind === "instrument");
  const warnings: string[] = [];
  const artifacts: RenderedArtifact[] = [];

  if (manifest.scope.kind === "stems") {
    for (const trackId of manifest.scope.trackIds) {
      const track = instrumentTracks.find((candidate) => candidate.id === trackId);
      if (!track)
        throw new Error(`Track '${trackId}' was not found or is not an instrument track.`);
      const frozen = options.preFader?.get(track.id);
      const buffer = frozen ? channelStrip(frozen, track, totalSamples) : renderFrequencyDroneTrackBuffer(track, project.tracks, totalSamples, sampleRate, totalSamples / sampleRate, true) ?? renderTrackBuffer(
        track,
        project.tracks,
        range,
        totalSamples,
        sampleRate,
        ppq,
        beatsPerBar,
        bpm,
        true
      );
      artifacts.push(
        buildArtifact(manifest, buffer, track.id, `${slugify(track.name)}.wav`, warnings)
      );
    }
  } else {
    let master: StereoBuffer = {
      left: new Float64Array(totalSamples),
      right: new Float64Array(totalSamples)
    };
    const reverbSend: StereoBuffer = {
      left: new Float64Array(totalSamples),
      right: new Float64Array(totalSamples)
    };
    const mixer = project.mixer ?? defaultMixer();
    const channelGain = (settings: { muted: boolean; volumeDb: number }) => settings.muted ? 0 : 10 ** (settings.volumeDb / 20);
    for (const track of instrumentTracks) {
      const frozen = options.preFader?.get(track.id);
      const trackBuffer = frozen
        ? trackAudible(track, project.tracks)
          ? channelStrip(frozen, track, totalSamples)
          : { left: new Float64Array(totalSamples), right: new Float64Array(totalSamples) }
        : renderFrequencyDroneTrackBuffer(track, project.tracks, totalSamples, sampleRate, totalSamples / sampleRate, false) ?? renderTrackBuffer(
        track,
        project.tracks,
        range,
        totalSamples,
        sampleRate,
        ppq,
        beatsPerBar,
        bpm,
        false
      );
      const output = resolveTrackOutput(track);
      mixIntoScaled(master, trackBuffer, output === "master" ? 1 : channelGain(mixer[output]));
      mixIntoScaled(reverbSend, trackBuffer, resolveTrackSend(track));
    }
    mixIntoScaled(master, applyReverb(reverbSend, MASTER_REVERB_DECAY_SECONDS, sampleRate), channelGain(mixer.reverb));
    const compressed = applyCompressor(master, MASTER_COMPRESSOR, sampleRate);
    master = compressed.buffer;
    const masterGain = channelGain(mixer.master);
    for (let index = 0; index < totalSamples; index++) {
      master.left[index]! *= masterGain;
      master.right[index]! *= masterGain;
    }
    warnings.push(...compressed.warnings);
    artifacts.push(buildArtifact(manifest, master, null, "master.wav", warnings));
  }

  const result: RenderResult = {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId: manifest.renderId,
    status: "completed",
    artifacts: artifacts.map((artifact) => artifact.metadata),
    warnings,
    errorCode: null,
    errorMessage: null,
    completedAt: new Date().toISOString()
  };

  return { result, artifacts };
}

/**
 * A plug-in freeze (cutover step E): the track's pre-fader signal through its devices up to and
 * including the frozen one, as one WAV. Built-in devices are the synth itself; bypassed plug-ins
 * are skipped; any other plug-in needs a deterministic first-party processor or the job fails.
 */
export function renderPluginFreeze(project: MusicProjectV2, manifest: RenderManifest): OfflineRenderOutcome {
  if (manifest.scope.kind !== "plugin-freeze") throw new Error("renderPluginFreeze needs a plugin-freeze scope.");
  const { trackId, deviceId } = manifest.scope;
  if (project.projectId !== manifest.projectId || project.revisionId !== manifest.revisionId) {
    throw new Error("The freeze manifest does not match the loaded project revision.");
  }
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track || track.kind !== "instrument") throw new Error(`Track '${trackId}' was not found or is not an instrument track.`);
  const deviceIndex = track.devices.findIndex((device) => device.id === deviceId);
  if (deviceIndex < 0) throw new Error(`Device '${deviceId}' was not found on track '${trackId}'.`);
  const target = track.devices[deviceIndex]!;
  if (target.plugin.runtimeKind === "builtin") throw new Error("Built-in devices don't need freezing.");

  const chain: { device: (typeof track.devices)[number]; processor: OfflinePluginProcessor }[] = [];
  const unsupported: { trackId: string; deviceId: string; pluginId: string; reason: string }[] = [];
  for (const device of track.devices.slice(0, deviceIndex + 1)) {
    if (device.plugin.runtimeKind === "builtin" || !device.enabled) continue;
    const processor = offlineProcessorFor(device);
    if (typeof processor === "string") unsupported.push({ trackId, deviceId: device.id, pluginId: device.plugin.pluginId, reason: processor });
    else chain.push({ device, processor });
  }
  if (unsupported.length > 0) throw new PluginRenderUnsupportedError(unsupported);

  const builtin = projectV2BuiltinView(project);
  const builtinTrack = builtin.tracks.find((candidate) => candidate.id === trackId)!;
  if (builtinTrack.devices.some((device) => device.deviceType === "synaptix-frequency-drone")) {
    throw new Error("Frequency drone tracks can't be frozen yet.");
  }
  const ppq = builtin.transport.ticksPerQuarterNote;
  const beatsPerBar = builtin.timeSignatureMap[0]?.numerator ?? 4;
  const bpm = builtin.tempoMap[0]?.bpm ?? 120;
  const sampleRate = manifest.output.sampleRate;
  const range: TickRange = { startTick: manifest.range.startTick, endTick: manifest.range.endTick };
  const totalSamples = Math.max(
    1,
    Math.round((ticksToSeconds(range.endTick - range.startTick, ppq, bpm) + manifest.output.includeTailSeconds) * sampleRate)
  );

  const buffer = renderTrackBuffer(builtinTrack, builtin.tracks, range, totalSamples, sampleRate, ppq, beatsPerBar, bpm, true, false);
  for (const { device, processor } of chain) processor.process(buffer, device, sampleRate);

  const warnings: string[] = [];
  const artifacts = [
    buildArtifact(manifest, buffer, trackId, `freeze-${slugify(track.name)}-${slugify(target.plugin.pluginId)}.wav`, warnings)
  ];
  const result: RenderResult = {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId: manifest.renderId,
    status: "completed",
    artifacts: artifacts.map((artifact) => artifact.metadata),
    warnings,
    errorCode: null,
    errorMessage: null,
    completedAt: new Date().toISOString()
  };
  return { result, artifacts };
}
