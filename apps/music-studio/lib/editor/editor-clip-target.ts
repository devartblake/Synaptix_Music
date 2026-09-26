import type { MusicProject } from "@synaptix/project-model";

import { isDrumTrack } from "./drum-step-sequencer-model.ts";

export type EditorKind = "piano-roll" | "drum-sequencer";
export interface EditorClip {
  trackId: string;
  clipId: string;
}

/** Which editor a track's MIDI clips open in. */
export function editorKindForTrack(project: MusicProject, trackId: string): EditorKind | null {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return null;
  return isDrumTrack(track) ? "drum-sequencer" : "piano-roll";
}

/**
 * The clip a sidebar editor entry should open: the clip already being edited
 * when it suits that editor, otherwise the first MIDI clip on a matching track.
 */
export function findEditorClip(
  project: MusicProject,
  kind: EditorKind,
  current: EditorClip | null = null
): EditorClip | null {
  if (current && editorKindForTrack(project, current.trackId) === kind) {
    const track = project.tracks.find((candidate) => candidate.id === current.trackId);
    if (track?.clips.some((clip) => clip.id === current.clipId && clip.kind === "midi")) return current;
  }
  for (const track of project.tracks) {
    if (track.kind !== "instrument" || (isDrumTrack(track) ? "drum-sequencer" : "piano-roll") !== kind) continue;
    const clip = track.clips.find((candidate) => candidate.kind === "midi");
    if (clip) return { trackId: track.id, clipId: clip.id };
  }
  return null;
}
