import type { GenerationProposal } from "@synaptix/generator-contracts";
import { MusicProjectSchema, type MusicProject } from "@synaptix/project-model";
import type { EditorCommand } from "@synaptix/command-system/editor";

type ArrangementSnapshot = Pick<MusicProject, "tracks" | "tempoMap" | "markers" | "generationMetadata">;

function snapshot(project: MusicProject): ArrangementSnapshot {
  return structuredClone({
    tracks: project.tracks,
    tempoMap: project.tempoMap,
    markers: project.markers,
    generationMetadata: project.generationMetadata
  });
}

function restore(project: MusicProject, value: ArrangementSnapshot): MusicProject {
  return MusicProjectSchema.parse({ ...structuredClone(project), ...structuredClone(value) });
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
      volumeDb: 0,
      pan: 0,
      devices: [{ id: `device-${track.id}`, deviceType: track.instrumentId, deviceVersion: "1.0.0", enabled: true, parameters: [] }],
      clips: track.clips.map((clip) => ({ ...structuredClone(clip), kind: "midi" as const }))
    }));
    return restore(project, {
      tracks,
      tempoMap: [{ id: "tempo-generated-1", position: { bar: 0, beat: 0, tick: 0 }, bpm: this.proposal.tempo }],
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
