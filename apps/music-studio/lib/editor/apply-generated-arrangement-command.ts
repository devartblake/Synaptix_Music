import { KEY_TONICS, type GenerationProposal } from "@synaptix/generator-contracts";
import { MUSICAL_KEY_MODES, MusicProjectSchema, type MusicProject } from "@synaptix/project-model";
import type { EditorCommand } from "@synaptix/command-system/editor";

type ArrangementSnapshot = Pick<MusicProject, "tracks" | "tempoMap" | "markers" | "key" | "generationMetadata">;

function snapshot(project: MusicProject): ArrangementSnapshot {
  return structuredClone({
    tracks: project.tracks,
    tempoMap: project.tempoMap,
    markers: project.markers,
    key: project.key,
    generationMetadata: project.generationMetadata
  });
}

function restore(project: MusicProject, value: ArrangementSnapshot): MusicProject {
  const next = { ...structuredClone(project), ...structuredClone(value) };
  // An absent key stays absent (not `key: undefined`), so a keyless project keeps its checksum.
  if (!next.key) delete next.key;
  return MusicProjectSchema.parse(next);
}

/** "Eb minor" → { tonic: 3, mode: "minor" }; null for anything else. */
export function projectKeyFromGeneration(key: string): MusicProject["key"] | null {
  const space = key.indexOf(" ");
  const tonic = (KEY_TONICS as readonly string[]).indexOf(key.slice(0, space));
  const mode = key.slice(space + 1);
  return space > 0 && tonic >= 0 && (MUSICAL_KEY_MODES as readonly string[]).includes(mode)
    ? { tonic, mode: mode as NonNullable<MusicProject["key"]>["mode"] } : null;
}

export class ApplyGeneratedArrangementEditorCommand implements EditorCommand {
  readonly kind = "apply-generated-arrangement";
  private previous: ArrangementSnapshot | null = null;

  constructor(
    readonly proposal: GenerationProposal,
    readonly jobId: string,
    readonly id = `generation-job-${jobId}`,
    private readonly appliedAt = new Date().toISOString()
  ) {}

  execute(project: MusicProject): MusicProject {
    if (this.proposal.projectId !== project.projectId) throw new Error("The generated arrangement belongs to a different project.");
    this.previous = snapshot(project);
    const tracks: MusicProject["tracks"] = this.proposal.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      kind: "instrument",
      muted: false,
      solo: false,
      volumeDb: track.volumeDb ?? 0,
      pan: track.pan ?? 0,
      ...(track.reverbSend != null ? { reverbSend: track.reverbSend } : {}),
      devices: [{ id: `device-${track.id}`, deviceType: track.instrumentId, deviceVersion: "1.0.0", enabled: true, parameters: [] }],
      clips: track.clips.map((clip) => ({ ...structuredClone(clip), kind: "midi" as const }))
    }));
    return restore(project, {
      tracks,
      tempoMap: [{ id: "tempo-generated-1", position: { bar: 0, beat: 0, tick: 0 }, bpm: this.proposal.tempo }],
      // The generator picked a key: the project now carries it (undo restores the previous one).
      key: projectKeyFromGeneration(this.proposal.key) ?? project.key,
      markers: this.proposal.sections.map((section) => ({ id: section.id, name: section.name, position: { bar: section.startBar, beat: 0, tick: 0 }, kind: "section" as const })),
      generationMetadata: {
        generatorId: this.proposal.provenance.generatorId,
        generatorVersion: this.proposal.provenance.generatorVersion,
        seed: this.proposal.provenance.seed,
        createdAt: this.appliedAt,
        prompt: `${this.proposal.genre}:${this.proposal.mood}:${this.proposal.key}`
      }
    });
  }

  undo(project: MusicProject): MusicProject {
    if (!this.previous) throw new Error("ApplyGeneratedArrangementEditorCommand must execute before undo.");
    return restore(project, this.previous);
  }
}
