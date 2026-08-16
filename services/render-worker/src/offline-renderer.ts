import { createHash } from "node:crypto";

import { resolveEffectiveInstrumentSettings, type EffectiveInstrumentSettings } from "@synaptix/daw-engine/production-audio";
import type { MusicProject, MusicalPosition, Track } from "@synaptix/project-model";
import { RENDER_CONTRACT_VERSION, type RenderArtifact, type RenderManifest, type RenderResult } from "@synaptix/render-contracts";

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
 * math so it never depends on a Web Audio implementation. Reverb and master
 * compression are not modeled yet — this renders the dry signal only; that
 * is a documented follow-up, not an oversight.
 */

const OSCILLATORS: Record<EffectiveInstrumentSettings["oscillator"], (cyclePhase: number) => number> = {
  sine: (cycle) => Math.sin(2 * Math.PI * cycle),
  square: (cycle) => (cycle < 0.5 ? 1 : -1),
  sawtooth: (cycle) => 2 * cycle - 1,
  triangle: (cycle) => (cycle < 0.5 ? 4 * cycle - 1 : 3 - 4 * cycle)
};

function oscillatorValue(kind: EffectiveInstrumentSettings["oscillator"], phase: number): number {
  const cycle = phase - Math.floor(phase);
  return OSCILLATORS[kind](cycle);
}

function midiToFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

function envelopeValue(settings: EffectiveInstrumentSettings, timeSeconds: number, noteDurationSeconds: number): number {
  const { attack, decay, sustain, release } = settings;
  if (timeSeconds < 0) return 0;
  if (timeSeconds < attack) return attack > 0 ? timeSeconds / attack : 1;
  const sinceDecayStart = timeSeconds - attack;
  if (sinceDecayStart < decay) return decay > 0 ? 1 - (1 - sustain) * (sinceDecayStart / decay) : sustain;
  if (timeSeconds < noteDurationSeconds) return sustain;
  const sinceRelease = timeSeconds - noteDurationSeconds;
  if (sinceRelease >= release) return 0;
  return release > 0 ? sustain * (1 - sinceRelease / release) : 0;
}

function ticksToSeconds(ticks: number, ppq: number, bpm: number): number {
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

function renderTrackBuffer(
  track: Track,
  tracks: readonly Track[],
  range: TickRange,
  totalSamples: number,
  sampleRate: number,
  ppq: number,
  beatsPerBar: number,
  bpm: number,
  forceAudible: boolean
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

      let filtered = 0;
      for (let sampleIndex = 0; sampleIndex < noteTotalSamples; sampleIndex++) {
        const targetSample = noteStartSample + sampleIndex;
        if (targetSample < 0 || targetSample >= totalSamples) continue;
        const timeSeconds = sampleIndex / sampleRate;
        const raw = oscillatorValue(settings.oscillator, timeSeconds * frequency);
        filtered += alpha * (raw - filtered);
        const value = filtered * envelopeValue(settings, timeSeconds, noteDurationSeconds) * velocityGain;
        left[targetSample] = (left[targetSample] ?? 0) + value;
        right[targetSample] = (right[targetSample] ?? 0) + value;
      }
    }
  }

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

function mixInto(target: StereoBuffer, source: StereoBuffer): void {
  for (let i = 0; i < target.left.length; i++) {
    target.left[i] = (target.left[i] ?? 0) + (source.left[i] ?? 0);
    target.right[i] = (target.right[i] ?? 0) + (source.right[i] ?? 0);
  }
}

function peakAmplitude(buffer: StereoBuffer): number {
  let peak = 0;
  for (const channel of [buffer.left, buffer.right]) {
    for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i] ?? 0));
  }
  return peak;
}

function applyNormalization(buffer: StereoBuffer, targetDbfs: number | null, warnings: string[], label: string): void {
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
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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
  if (clampAndDetectClipping(buffer)) warnings.push(`Clipping occurred while rendering '${fileName}'.`);

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

export function renderProjectOffline(project: MusicProject, manifest: RenderManifest): OfflineRenderOutcome {
  if (project.projectId !== manifest.projectId) {
    throw new Error(`Manifest projectId '${manifest.projectId}' does not match project '${project.projectId}'.`);
  }
  if (project.revisionId !== manifest.revisionId) {
    throw new Error(`Manifest revisionId '${manifest.revisionId}' does not match project revision '${project.revisionId}'.`);
  }

  const ppq = project.transport.ticksPerQuarterNote;
  const beatsPerBar = project.timeSignatureMap[0]?.numerator ?? 4;
  const bpm = project.tempoMap[0]?.bpm ?? 120;
  const sampleRate = manifest.output.sampleRate;
  const range: TickRange = { startTick: manifest.range.startTick, endTick: manifest.range.endTick };

  const rangeSeconds = ticksToSeconds(range.endTick - range.startTick, ppq, bpm);
  const totalSamples = Math.max(1, Math.round((rangeSeconds + manifest.output.includeTailSeconds) * sampleRate));

  const instrumentTracks = project.tracks.filter((track) => track.kind === "instrument");
  const warnings: string[] = [];
  const artifacts: RenderedArtifact[] = [];

  if (manifest.scope.kind === "stems") {
    for (const trackId of manifest.scope.trackIds) {
      const track = instrumentTracks.find((candidate) => candidate.id === trackId);
      if (!track) throw new Error(`Track '${trackId}' was not found or is not an instrument track.`);
      const buffer = renderTrackBuffer(track, project.tracks, range, totalSamples, sampleRate, ppq, beatsPerBar, bpm, true);
      artifacts.push(buildArtifact(manifest, buffer, track.id, `${slugify(track.name)}.wav`, warnings));
    }
  } else {
    const master: StereoBuffer = { left: new Float64Array(totalSamples), right: new Float64Array(totalSamples) };
    for (const track of instrumentTracks) {
      mixInto(master, renderTrackBuffer(track, project.tracks, range, totalSamples, sampleRate, ppq, beatsPerBar, bpm, false));
    }
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
