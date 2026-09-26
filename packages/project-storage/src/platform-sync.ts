import { computeProjectChecksum, type ProjectRevision } from "@synaptix/command-system";
import { downgradeProjectV2ToV1 } from "@synaptix/project-model/v2";

import type { StoredMusicProject } from "./index.ts";

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
  project: StoredMusicProject;
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

interface IndexedDbProjectSyncQueueOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
}

const SYNC_QUEUE_DATABASE_VERSION = 1;
const SYNC_QUEUE_STORE = "project-sync-operations";

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Sync queue transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Sync queue transaction failed."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Sync queue request failed."));
  });
}

export class IndexedDbProjectSyncQueue implements ProjectSyncQueue {
  private readonly databaseName: string;
  private readonly factory: IDBFactory;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbProjectSyncQueueOptions = {}) {
    this.databaseName = options.databaseName ?? "synaptix-music-sync";
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) throw new Error("IndexedDB is not available in this runtime.");
    this.factory = factory;
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, SYNC_QUEUE_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
          const store = database.createObjectStore(SYNC_QUEUE_STORE, { keyPath: "operationId" });
          store.createIndex("queuedAt", "queuedAt", { unique: false });
          store.createIndex("projectId", "projectId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open project sync queue."));
      request.onblocked = () => reject(new Error("Project sync queue upgrade is blocked."));
    });
    return this.databasePromise;
  }

  async enqueue(operation: QueuedProjectSyncOperation): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SYNC_QUEUE_STORE, "readwrite");
    transaction.objectStore(SYNC_QUEUE_STORE).put(structuredClone(operation));
    await transactionDone(transaction);
  }

  async list(): Promise<QueuedProjectSyncOperation[]> {
    const database = await this.open();
    const transaction = database.transaction(SYNC_QUEUE_STORE, "readonly");
    const records = await requestResult(
      transaction.objectStore(SYNC_QUEUE_STORE).getAll() as IDBRequest<QueuedProjectSyncOperation[]>
    );
    await transactionDone(transaction);
    return records
      .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
      .map((operation) => structuredClone(operation));
  }

  async remove(operationId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SYNC_QUEUE_STORE, "readwrite");
    transaction.objectStore(SYNC_QUEUE_STORE).delete(operationId);
    await transactionDone(transaction);
  }
}

/** Project schema versions the platform API accepts for revision uploads. */
export type PlatformProjectSchemaVersion = 1 | 2;

/**
 * Converts a locally committed revision into what the platform accepts. Returns null when the
 * revision cannot be represented (a plug-in project while the platform only accepts v1); the
 * revision then stays local-only instead of being uploaded in a lossy form.
 */
export type PlatformEnvelopeConverter = (
  envelope: PlatformRevisionEnvelope
) => Promise<PlatformRevisionEnvelope | null>;

export function platformEnvelopeConverter(accepts: PlatformProjectSchemaVersion): PlatformEnvelopeConverter {
  return async (envelope) => {
    if (envelope.project.schemaVersion === 1 || accepts === 2) return structuredClone(envelope);
    const project = downgradeProjectV2ToV1(envelope.project);
    if (!project) return null;
    // The revision checksum must describe the snapshot that is actually uploaded.
    const checksumSha256 = await computeProjectChecksum(project);
    return { projectId: envelope.projectId, project, revision: { ...structuredClone(envelope.revision), checksumSha256 } };
  };
}

/** Point an upload's parent at the platform-known ancestor; the checksum covers the new snapshot. */
async function rebaseEnvelope(envelope: PlatformRevisionEnvelope, parentRevisionId: string | null): Promise<PlatformRevisionEnvelope> {
  const project = { ...structuredClone(envelope.project), parentRevisionId } as StoredMusicProject;
  return {
    projectId: envelope.projectId,
    project,
    revision: { ...structuredClone(envelope.revision), parentRevisionId, checksumSha256: await computeProjectChecksum(project) }
  };
}

export interface HybridProjectRepositoryOptions {
  /** Defaults to uploading revisions unchanged. */
  toPlatformEnvelope?: PlatformEnvelopeConverter;
}

/**
 * Result of queueing the local head: `current` (the platform already has it), `queued`,
 * `blocked` (this platform cannot store the project yet), or `missing` (nothing saved locally).
 */
export type QueueHeadOutcome = "current" | "queued" | "blocked" | "missing";

export interface SaveAndQueueResult {
  /** False when the revision was saved locally but cannot be uploaded to this platform. */
  queued: boolean;
}

export class HybridProjectRepository {
  private readonly toPlatformEnvelope: PlatformEnvelopeConverter;
  /**
   * Revisions saved locally but never uploaded, mapped to the last ancestor the platform can
   * know. Later uploads chain from that ancestor, so a local-only revision never becomes the
   * platform's expected head. Held in memory; after a reload the conflict flow resolves it.
   */
  private readonly localOnlyRevisions = new Map<string, string | null>();

  constructor(
    private readonly local: {
      save(project: StoredMusicProject, revision?: ProjectRevision): Promise<unknown>;
      load(projectId: string): Promise<StoredMusicProject | null>;
      /** Needed by queueUnsyncedHead to find the head's revision and ancestry. */
      revisions?(projectId: string): Promise<ProjectRevision[]>;
    },
    private readonly platform: PlatformProjectRepository,
    private readonly queue: ProjectSyncQueue,
    options: HybridProjectRepositoryOptions = {}
  ) {
    this.toPlatformEnvelope = options.toPlatformEnvelope ?? (async (envelope) => structuredClone(envelope));
  }

  async load(projectId: string): Promise<StoredMusicProject | null> {
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
  ): Promise<SaveAndQueueResult> {
    await this.local.save(envelope.project, envelope.revision);
    const platformExpected = expectedRevisionId !== null && this.localOnlyRevisions.has(expectedRevisionId)
      ? this.localOnlyRevisions.get(expectedRevisionId)!
      : expectedRevisionId;
    let platformEnvelope = await this.toPlatformEnvelope(envelope);
    if (!platformEnvelope) {
      this.localOnlyRevisions.set(envelope.revision.revisionId, platformExpected);
      return { queued: false };
    }
    if (platformExpected !== expectedRevisionId) platformEnvelope = await rebaseEnvelope(platformEnvelope, platformExpected);
    await this.queue.enqueue({
      operationId,
      projectId: envelope.projectId,
      expectedRevisionId: platformExpected,
      idempotencyKey,
      envelope: platformEnvelope,
      queuedAt: new Date().toISOString(),
      attemptCount: 0
    });
    return { queued: true };
  }

  /**
   * Queues the latest local revision when the platform never received it: for example a plug-in
   * revision saved while the platform only accepted v1, after the platform starts accepting v2.
   * A head that descends from the platform's head is re-parented onto it. One that diverged keeps
   * its own parent, so the upload surfaces as a conflict instead of overwriting the cloud copy.
   */
  async queueUnsyncedHead(projectId: string): Promise<QueueHeadOutcome> {
    const project = await this.local.load(projectId);
    const history = project && this.local.revisions ? await this.local.revisions(projectId) : [];
    const head = history.find((revision) => revision.revisionId === project?.revisionId);
    if (!project || !head) return "missing";

    const queued = await this.queue.list();
    if (queued.some((operation) => operation.projectId === projectId && operation.envelope.revision.revisionId === head.revisionId)) {
      return "queued";
    }
    const remoteHead = (await this.platform.getProject(projectId))?.revision.revisionId ?? null;
    if (remoteHead === head.revisionId) return "current";

    let platformEnvelope = await this.toPlatformEnvelope({ projectId, project, revision: head });
    if (!platformEnvelope) return "blocked";

    const parents = new Map(history.map((revision) => [revision.revisionId, revision.parentRevisionId]));
    let ancestor = head.parentRevisionId;
    const seen = new Set<string>();
    while (ancestor !== null && ancestor !== remoteHead && !seen.has(ancestor)) {
      seen.add(ancestor);
      ancestor = parents.get(ancestor) ?? null;
    }
    const expected = ancestor === remoteHead ? remoteHead : head.parentRevisionId;
    if (platformEnvelope.revision.parentRevisionId !== expected) {
      platformEnvelope = await rebaseEnvelope(platformEnvelope, expected);
    }
    await this.queue.enqueue({
      operationId: crypto.randomUUID(),
      projectId,
      expectedRevisionId: expected,
      idempotencyKey: `project-revision:${projectId}:${head.revisionId}`,
      envelope: platformEnvelope,
      queuedAt: new Date().toISOString(),
      attemptCount: 0
    });
    return "queued";
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
