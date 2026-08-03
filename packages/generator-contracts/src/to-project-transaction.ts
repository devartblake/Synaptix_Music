import {
  AddTrackCommand,
  CommandTransaction,
  commitTransaction,
  type CommandMetadata,
  type ProjectRevision,
  type SerializedCommand,
  type StudioCommand
} from "@synaptix/command-system";
import {
  MusicProjectSchema,
  type Marker,
  type MusicProject,
  type Track
} from "@synaptix/project-model";

import {
  GenerationProposalSchema,
  type GenerationProposal,
  type GeneratedTrack
} from "./index";

export interface GenerationTransactionOptions {
  transactionId?: string;
  revisionId?: string;
  timestamp?: string;
  commandIdPrefix?: string;
}

interface GenerationStateSnapshot {
  tempoMap: MusicProject["tempoMap"];
  markers: Marker[];
  generationMetadata: MusicProject["generationMetadata"];
}

export type SerializedGenerationStateCommand = {
  type: "apply-generation-state";
  commandId: string;
  tempo: number;
  markers: Marker[];
  generatorId: string;
  generatorVersion: string;
  seed: number;
  createdAt: string;
};

class ApplyGenerationStateCommand implements StudioCommand {
  readonly type = "apply-generation-state" as const;
  readonly id: string;
  private previous: GenerationStateSnapshot | null = null;

  constructor(
    private readonly proposal: GenerationProposal,
    private readonly timestamp: string,
    metadata: CommandMetadata = {}
  ) {
    this.id = metadata.id ?? crypto.randomUUID();
  }

  execute(project: MusicProject): MusicProject {
    const next = structuredClone(project);
    this.previous = {
      tempoMap: structuredClone(next.tempoMap),
      markers: structuredClone(next.markers),
      generationMetadata: structuredClone(next.generationMetadata)
    };

    next.tempoMap = [
      {
        id: "tempo-generated-1",
        position: { bar: 0, beat: 0, tick: 0 },
        bpm: this.proposal.tempo
      }
    ];
    next.markers = this.proposal.sections.map((section) => ({
      id: section.id,
      name: section.name,
      position: { bar: section.startBar, beat: 0, tick: 0 },
      kind: "section" as const
    }));
    next.generationMetadata = {
      generatorId: this.proposal.provenance.generatorId,
      generatorVersion: this.proposal.provenance.generatorVersion,
      seed: this.proposal.provenance.seed,
      createdAt: this.timestamp,
      prompt: `${this.proposal.genre}:${this.proposal.mood}:${this.proposal.key}`
    };
    return MusicProjectSchema.parse(next);
  }

  undo(project: MusicProject): MusicProject {
    if (!this.previous) {
      throw new Error("ApplyGenerationStateCommand must execute before it can be undone.");
    }
    const next = structuredClone(project);
    next.tempoMap = structuredClone(this.previous.tempoMap);
    next.markers = structuredClone(this.previous.markers);
    next.generationMetadata = structuredClone(this.previous.generationMetadata);
    return MusicProjectSchema.parse(next);
  }

  serialize(): SerializedCommand {
    return {
      type: this.type,
      commandId: this.id,
      tempo: this.proposal.tempo,
      markers: this.proposal.sections.map((section) => ({
        id: section.id,
        name: section.name,
        position: { bar: section.startBar, beat: 0, tick: 0 },
        kind: "section" as const
      })),
      generatorId: this.proposal.provenance.generatorId,
      generatorVersion: this.proposal.provenance.generatorVersion,
      seed: this.proposal.provenance.seed,
      createdAt: this.timestamp
    } as SerializedCommand;
  }
}

function toTrack(generated: GeneratedTrack): Track {
  return {
    id: generated.id,
    name: generated.name,
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: 0,
    pan: 0,
    devices: [
      {
        id: `device-${generated.id}`,
        deviceType: generated.instrumentId,
        deviceVersion: "1.0.0",
        enabled: true,
        parameters: []
      }
    ],
    clips: generated.clips.map((clip) => ({
      ...structuredClone(clip),
      kind: "midi" as const
    }))
  };
}

export function generationProposalToTransaction(
  input: GenerationProposal,
  options: GenerationTransactionOptions = {}
): CommandTransaction {
  const proposal = GenerationProposalSchema.parse(input);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const prefix = options.commandIdPrefix ?? `generation-${proposal.provenance.seed}`;
  const commands: StudioCommand[] = [
    new ApplyGenerationStateCommand(proposal, timestamp, { id: `${prefix}-state` })
  ];

  proposal.tracks.forEach((track, index) => {
    commands.push(new AddTrackCommand(toTrack(track), index, { id: `${prefix}-track-${index}` }));
  });

  return new CommandTransaction(commands, {
    id: options.transactionId ?? `${prefix}-transaction`,
    timestamp
  });
}

export async function applyGenerationProposal(
  project: MusicProject,
  input: GenerationProposal,
  options: GenerationTransactionOptions = {}
): Promise<{ project: MusicProject; revision: ProjectRevision; transaction: CommandTransaction }> {
  const proposal = GenerationProposalSchema.parse(input);
  if (proposal.projectId !== project.projectId) {
    throw new Error(
      `Generation proposal project '${proposal.projectId}' does not match '${project.projectId}'.`
    );
  }
  if (project.tracks.length > 0) {
    throw new Error("Generation proposal v1 can only be applied to an empty project.");
  }

  const transaction = generationProposalToTransaction(proposal, options);
  const result = await commitTransaction(project, transaction, {
    revisionId: options.revisionId,
    timestamp: options.timestamp
  });

  return { ...result, transaction };
}
