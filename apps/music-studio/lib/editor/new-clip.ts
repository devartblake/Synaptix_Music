import type { Clip, MusicProject, Track } from "@synaptix/project-model";

import { barTicks, positionTicks } from "./timeline-model.ts";

export const NEW_CLIP_BARS = 4;

/** Drone devices play continuously and ignore notes, so they never get MIDI clips. */
export function canAddMidiClip(track: Track): boolean {
  return (
    track.kind === "instrument" &&
    !track.devices.some((device) => device.deviceType === "synaptix-frequency-drone")
  );
}

/** An empty MIDI clip starting on the first whole bar after the track's last clip. */
export function createEmptyMidiClip(
  project: MusicProject,
  track: Track,
  id: string = crypto.randomUUID()
): Clip {
  const ticksPerBar = barTicks(project);
  const end = track.clips.reduce(
    (latest, clip) => Math.max(latest, positionTicks(project, clip.range.start) + clip.range.durationTicks),
    0
  );
  const bar = Math.ceil(end / ticksPerBar);
  return {
    id: `clip-${id}`,
    kind: "midi",
    name: `${track.name} clip ${track.clips.length + 1}`,
    range: { start: { bar, beat: 0, tick: 0 }, durationTicks: NEW_CLIP_BARS * ticksPerBar },
    loop: false,
    notes: []
  };
}
