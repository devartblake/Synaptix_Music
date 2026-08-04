import type { ProjectRevision } from "@synaptix/command-system";
import type { MusicProject } from "@synaptix/project-model";

export interface PlatformProjectSummary {
  projectId: string;
  name: string;
  currentRevisionId: string;
  updatedAt: string;
  archived: boolean;
}

export interface PlatformRevisionEnvelope {
  projectId: string;
  revision: ProjectRevision;
  project: MusicProject;
}

export type RevisionUploadResult =
  | { outcome: "accepted"; currentRevisionId: string }
  | { outcome: "alreadyCurrent"; currentRevisionId: string }
  | {
      outcome: "conflict";
      expectedRevisionId: string;
      currentRevisionId: string;
      remote: PlatformRevisionEnvelope;
    };

export interface PlatformProjectRepository {
  listProjects(): Promise<PlatformProjectSummary[]>;
  getProject(projectId: string): Promise<PlatformRevisionEnvelope | null>;
  uploadRevision(
    envelope: PlatformRevisionEnvelope,
    expectedRevisionId: string | null,
    idempotencyKey: string
  ): Promise<RevisionUploadResult>;
}

export interface QueuedProjectSyncOperation {
  operationId: string;
  projectId: string;
  expectedRevisionId: string | null;
  idempotencyKey: string;
  envelope: PlatformRevisionEnvelope;
  queuedAt: string;
  attemptCount: number;
}

export interface ProjectSyncQueue {
  enqueue(operation: QueuedProjectSyncOperation): Promise<void>;
  list(): Promise<QueuedProjectSyncOperation[]>;
  remove(operationId: string): Promise<void>;
}

export class InMemoryProjectSyncQueue implements ProjectSyncQueue {
  private readonly operations = new Map<string, QueuedProjectSyncOperation>();

  async enqueue(operation: QueuedProjectSyncOperation): Promise<void> {
    this.operations.set(operation.operationId, structuredClone(operation));
  }

  async list(): Promise<QueuedProjectSyncOperation[]> {
    return [...this.operations.values()]
      .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
      .map((operation) => structuredClone(operation));
  }

  async remove(operationId: string): Promise<void> {
    this.operations.delete(operationId);
  }
}

export class HybridProjectRepository {
  constructor(
    private readonly local: {
      save(project: MusicProject, revision?: ProjectRevision): Promise<unknown>;
      load(projectId: string): Promise<MusicProject | null>;
    },
    private readonly platform: PlatformProjectRepository,
    private readonly queue: ProjectSyncQueue
  ) {}

  async load(projectId: string): Promise<MusicProject | null> {
    const localProject = await this.local.load(projectId);
    if (localProject) return localProject;

    const remote = await this.platform.getProject(projectId);
    if (!remote) return null;
    await this.local.save(remote.project, remote.revision);
    return structuredClone(remote.project);
  }

  async saveAndQueue(
    envelope: PlatformRevisionEnvelope,
    expectedRevisionId: string | null,
    idempotencyKey: string,
    operationId = crypto.randomUUID()
  ): Promise<void> {
    await this.local.save(envelope.project, envelope.revision);
    await this.queue.enqueue({
      operationId,
      projectId: envelope.projectId,
      expectedRevisionId,
      idempotencyKey,
      envelope: structuredClone(envelope),
      queuedAt: new Date().toISOString(),
      attemptCount: 0
    });
  }

  async drain(): Promise<RevisionUploadResult[]> {
    const results: RevisionUploadResult[] = [];
    for (const operation of await this.queue.list()) {
      const result = await this.platform.uploadRevision(
        operation.envelope,
        operation.expectedRevisionId,
        operation.idempotencyKey
      );
      results.push(result);
      if (result.outcome !== "conflict") {
        await this.queue.remove(operation.operationId);
      }
    }
    return results;
  }
}
