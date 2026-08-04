import { applyGenerationProposal } from "@synaptix/generator-contracts";
import type { GenerationJob } from "@synaptix/platform-contracts";
import type { MusicProject } from "@synaptix/project-model";

export interface AppliedGenerationJobRegistry {
  has(jobId: string): boolean | Promise<boolean>;
  add(jobId: string): void | Promise<void>;
}

export class BrowserAppliedGenerationJobRegistry implements AppliedGenerationJobRegistry {
  constructor(private readonly storageKey = "synaptix.music.applied-generation-jobs.v1") {}

  has(jobId: string): boolean {
    return this.read().has(jobId);
  }

  add(jobId: string): void {
    const jobs = this.read();
    jobs.add(jobId);
    globalThis.localStorage?.setItem(this.storageKey, JSON.stringify([...jobs]));
  }

  private read(): Set<string> {
    if (typeof globalThis.localStorage === "undefined") return new Set();
    const raw = globalThis.localStorage.getItem(this.storageKey);
    if (!raw) return new Set();
    try {
      const parsed: unknown = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
    } catch {
      return new Set();
    }
  }
}

export type CompletedGenerationApplicationResult =
  | { status: "not-completed"; project: MusicProject }
  | { status: "already-applied"; project: MusicProject }
  | {
      status: "applied";
      project: MusicProject;
      revisionId: string;
      transactionId: string;
    };

export async function applyCompletedGenerationJob(
  project: MusicProject,
  job: GenerationJob,
  registry: AppliedGenerationJobRegistry
): Promise<CompletedGenerationApplicationResult> {
  if (job.status !== "completed" || !job.result) {
    return { status: "not-completed", project };
  }
  if (await registry.has(job.jobId)) {
    return { status: "already-applied", project };
  }

  const transactionId = `generation-job-${job.jobId}`;
  const revisionId = `generation-job-${job.jobId}-revision`;
  const applied = await applyGenerationProposal(project, job.result, {
    transactionId,
    revisionId,
    commandIdPrefix: `generation-job-${job.jobId}`,
    timestamp: job.updatedAt
  });

  await registry.add(job.jobId);
  return {
    status: "applied",
    project: applied.project,
    revisionId: applied.revision.revisionId,
    transactionId: applied.transaction.id
  };
}
