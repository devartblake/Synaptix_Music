import type { Clip, MusicProject, MusicalPosition } from "@synaptix/project-model";

// Match the audio engine's current first-signature timing contract.
export function barTicks(project: MusicProject): number {
  return project.transport.ticksPerQuarterNote * (project.timeSignatureMap[0]?.numerator ?? 4);
}

export function positionTicks(project: MusicProject, position: MusicalPosition): number {
  return (
    position.bar * barTicks(project) +
    position.beat * project.transport.ticksPerQuarterNote +
    position.tick
  );
}

export function arrangementBars(project: MusicProject): number {
  const ends = project.tracks.flatMap((track) =>
    track.clips.map((clip) => positionTicks(project, clip.range.start) + clip.range.durationTicks)
  );
  const loop = project.transport.loopRange;
  if (loop) ends.push(positionTicks(project, loop.start) + loop.durationTicks);
  return Math.max(4, Math.ceil(Math.max(0, ...ends) / barTicks(project)));
}

export function clipPlaybackTick(project: MusicProject, clip: Clip, tick: number): number | null {
  const local = tick - positionTicks(project, clip.range.start);
  return local >= 0 && local < clip.range.durationTicks ? local : null;
}

export function transportLabel(project: MusicProject, ticks: number): string {
  const ppq = project.transport.ticksPerQuarterNote;
  const perBar = barTicks(project);
  const tick = Math.max(0, Math.floor(ticks));
  return `${Math.floor(tick / perBar) + 1}:${Math.floor((tick % perBar) / ppq) + 1}:${String(tick % ppq).padStart(3, "0")}`;
}

/** Clock time at a tick, as m:ss.s, at the first tempo (the engine's current timing contract). */
export function transportTime(project: MusicProject, ticks: number): string {
  const bpm = project.tempoMap[0]?.bpm ?? 120;
  const tenths = Math.floor((Math.max(0, ticks) / project.transport.ticksPerQuarterNote) * (60 / bpm) * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, "0")}.${tenths % 10}`;
}

/** The musical position of a tick (the inverse of positionTicks). */
export function tickPosition(project: MusicProject, ticks: number): MusicalPosition {
  const ppq = project.transport.ticksPerQuarterNote;
  const perBar = barTicks(project);
  const tick = Math.max(0, Math.floor(ticks));
  return { bar: Math.floor(tick / perBar), beat: Math.floor((tick % perBar) / ppq), tick: tick % ppq };
}

/** Whole bars from `from` to `to` inclusive, in either order, as a loop range. */
export function barRange(project: MusicProject, from: number, to: number) {
  const first = Math.max(0, Math.min(from, to));
  const last = Math.max(0, Math.max(from, to));
  return { start: { bar: first, beat: 0, tick: 0 }, durationTicks: (last - first + 1) * barTicks(project) };
}
