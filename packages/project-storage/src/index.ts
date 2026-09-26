import { computeProjectChecksum, type ProjectRevision } from "@synaptix/command-system";
import { MusicProjectSchema, type MusicProject } from "@synaptix/project-model";
import { MusicProjectV2Schema, type MusicProjectV2 } from "@synaptix/project-model/v2";

export const LOCAL_STORAGE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_DATABASE_NAME = "synaptix-music";

export interface StoredProjectSummary {
  projectId: string;
  name: string;
  revisionId: string;
  updatedAt: string;
  createdAt: string;
  checksumSha256: string;
}

export type StoredMusicProject = MusicProject | MusicProjectV2;

/** Validates a stored snapshot. The default accepts only v1 so existing callers never receive v2. */
export type ProjectSnapshotParser<P extends StoredMusicProject> = (value: unknown) => P;

export const parseMusicProjectV1: ProjectSnapshotParser<MusicProject> = (value) => MusicProjectSchema.parse(value);
export const parseMusicProjectV2: ProjectSnapshotParser<MusicProjectV2> = (value) => MusicProjectV2Schema.parse(value);

/** Accepts any supported project schema version, dispatching on `schemaVersion`. */
export const parseVersionedMusicProject: ProjectSnapshotParser<StoredMusicProject> = (value) => {
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version === 1) return parseMusicProjectV1(value);
  if (version === 2) return parseMusicProjectV2(value);
  throw new ProjectStorageCorruptionError(`Unsupported project schema version '${String(version)}'.`);
};

export interface StoredProjectRecord<P extends StoredMusicProject = MusicProject> extends StoredProjectSummary {
  storageSchemaVersion: typeof LOCAL_STORAGE_SCHEMA_VERSION;
  project: P;
}

export interface StoredRevisionRecord<P extends StoredMusicProject = MusicProject> {
  storageSchemaVersion: typeof LOCAL_STORAGE_SCHEMA_VERSION;
  projectId: string;
  revision: ProjectRevision;
  project: P;
}

export interface LocalProjectStorage {
  putProject(record: StoredProjectRecord<StoredMusicProject>): Promise<void>;
  getProject(projectId: string): Promise<StoredProjectRecord<StoredMusicProject> | null>;
  listProjects(): Promise<StoredProjectSummary[]>;
  deleteProject(projectId: string): Promise<void>;
  putRevision(record: StoredRevisionRecord<StoredMusicProject>): Promise<void>;
  getRevision(projectId: string, revisionId: string): Promise<StoredRevisionRecord<StoredMusicProject> | null>;
  listRevisions(projectId: string): Promise<StoredRevisionRecord<StoredMusicProject>[]>;
  clear(): Promise<void>;
}

export class ProjectStorageCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectStorageCorruptionError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function revisionKey(projectId: string, revisionId: string): string {
  return `${projectId}:${revisionId}`;
}

function summaryFromRecord(record: StoredProjectRecord<StoredMusicProject>): StoredProjectSummary {
  const { projectId, name, revisionId, updatedAt, createdAt, checksumSha256 } = record;
  return { projectId, name, revisionId, updatedAt, createdAt, checksumSha256 };
}

export async function createStoredProjectRecord<P extends StoredMusicProject = MusicProject>(
  project: P,
  parse: ProjectSnapshotParser<P> = parseMusicProjectV1 as ProjectSnapshotParser<P>
): Promise<StoredProjectRecord<P>> {
  const validated = parse(project);
  const checksumSha256 = await computeProjectChecksum(validated);
  return {
    storageSchemaVersion: LOCAL_STORAGE_SCHEMA_VERSION,
    projectId: validated.projectId,
    name: validated.metadata.name,
    revisionId: validated.revisionId,
    updatedAt: validated.metadata.updatedAt,
    createdAt: validated.metadata.createdAt,
    checksumSha256,
    project: clone(validated)
  };
}

export async function createStoredRevisionRecord<P extends StoredMusicProject = MusicProject>(
  project: P,
  revision: ProjectRevision,
  parse: ProjectSnapshotParser<P> = parseMusicProjectV1 as ProjectSnapshotParser<P>
): Promise<StoredRevisionRecord<P>> {
  const validated = parse(project);
  if (validated.projectId.length === 0 || validated.revisionId !== revision.revisionId) {
    throw new Error("Revision metadata does not match the project snapshot.");
  }
  const checksum = await computeProjectChecksum(validated);
  if (checksum !== revision.checksumSha256) {
    throw new ProjectStorageCorruptionError("Revision checksum does not match the project snapshot.");
  }
  return {
    storageSchemaVersion: LOCAL_STORAGE_SCHEMA_VERSION,
    projectId: validated.projectId,
    revision: clone(revision),
    project: clone(validated)
  };
}

export async function verifyStoredProjectRecord<P extends StoredMusicProject = MusicProject>(
  record: StoredProjectRecord<StoredMusicProject>,
  parse: ProjectSnapshotParser<P> = parseMusicProjectV1 as ProjectSnapshotParser<P>
): Promise<StoredProjectRecord<P>> {
  if (record.storageSchemaVersion !== LOCAL_STORAGE_SCHEMA_VERSION) {
    throw new ProjectStorageCorruptionError(
      `Unsupported local storage schema version '${record.storageSchemaVersion}'.`
    );
  }
  const project = parse(record.project);
  if (record.projectId !== project.projectId || record.revisionId !== project.revisionId) {
    throw new ProjectStorageCorruptionError("Stored project metadata does not match its snapshot.");
  }
  const checksum = await computeProjectChecksum(project);
  if (checksum !== record.checksumSha256) {
    throw new ProjectStorageCorruptionError("Stored project checksum verification failed.");
  }
  return {
    ...record,
    project: clone(project)
  };
}

export class InMemoryProjectStorage implements LocalProjectStorage {
  private readonly projects = new Map<string, StoredProjectRecord<StoredMusicProject>>();
  private readonly revisions = new Map<string, StoredRevisionRecord<StoredMusicProject>>();

  async putProject(record: StoredProjectRecord<StoredMusicProject>): Promise<void> {
    this.projects.set(record.projectId, clone(record));
  }

  async getProject(projectId: string): Promise<StoredProjectRecord<StoredMusicProject> | null> {
    const record = this.projects.get(projectId);
    return record ? clone(record) : null;
  }

  async listProjects(): Promise<StoredProjectSummary[]> {
    return [...this.projects.values()]
      .map(summaryFromRecord)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async deleteProject(projectId: string): Promise<void> {
    this.projects.delete(projectId);
    for (const key of this.revisions.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        this.revisions.delete(key);
      }
    }
  }

  async putRevision(record: StoredRevisionRecord<StoredMusicProject>): Promise<void> {
    this.revisions.set(revisionKey(record.projectId, record.revision.revisionId), clone(record));
  }

  async getRevision(projectId: string, revisionId: string): Promise<StoredRevisionRecord<StoredMusicProject> | null> {
    const record = this.revisions.get(revisionKey(projectId, revisionId));
    return record ? clone(record) : null;
  }

  async listRevisions(projectId: string): Promise<StoredRevisionRecord<StoredMusicProject>[]> {
    return [...this.revisions.values()]
      .filter((record) => record.projectId === projectId)
      .sort((left, right) => right.revision.createdAt.localeCompare(left.revision.createdAt))
      .map(clone);
  }

  async clear(): Promise<void> {
    this.projects.clear();
    this.revisions.clear();
  }
}

interface IndexedDbProjectStorageOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
}

const PROJECT_STORE = "projects";
const REVISION_STORE = "revisions";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

export class IndexedDbProjectStorage implements LocalProjectStorage {
  private readonly databaseName: string;
  private readonly factory: IDBFactory;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbProjectStorageOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) {
      throw new Error("IndexedDB is not available in this runtime.");
    }
    this.factory = factory;
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) {
      return this.databasePromise;
    }
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, LOCAL_STORAGE_SCHEMA_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PROJECT_STORE)) {
          database.createObjectStore(PROJECT_STORE, { keyPath: "projectId" });
        }
        if (!database.objectStoreNames.contains(REVISION_STORE)) {
          const store = database.createObjectStore(REVISION_STORE, {
            keyPath: ["projectId", "revision.revisionId"]
          });
          store.createIndex("projectId", "projectId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab."));
    });
    return this.databasePromise;
  }

  async putProject(record: StoredProjectRecord<StoredMusicProject>): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).put(clone(record));
    await transactionDone(transaction);
  }

  async getProject(projectId: string): Promise<StoredProjectRecord<StoredMusicProject> | null> {
    const database = await this.open();
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const result = await requestResult(
      transaction.objectStore(PROJECT_STORE).get(projectId) as IDBRequest<StoredProjectRecord<StoredMusicProject> | undefined>
    );
    await transactionDone(transaction);
    return result ? clone(result) : null;
  }

  async listProjects(): Promise<StoredProjectSummary[]> {
    const database = await this.open();
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const records = await requestResult(
      transaction.objectStore(PROJECT_STORE).getAll() as IDBRequest<StoredProjectRecord<StoredMusicProject>[]>
    );
    await transactionDone(transaction);
    return records.map(summaryFromRecord).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  async deleteProject(projectId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction([PROJECT_STORE, REVISION_STORE], "readwrite");
    transaction.objectStore(PROJECT_STORE).delete(projectId);
    const revisionStore = transaction.objectStore(REVISION_STORE);
    const index = revisionStore.index("projectId");
    const range = IDBKeyRange.only(projectId);
    const request = index.openKeyCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        revisionStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    await transactionDone(transaction);
  }

  async putRevision(record: StoredRevisionRecord<StoredMusicProject>): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(REVISION_STORE, "readwrite");
    transaction.objectStore(REVISION_STORE).put(clone(record));
    await transactionDone(transaction);
  }

  async getRevision(projectId: string, revisionId: string): Promise<StoredRevisionRecord<StoredMusicProject> | null> {
    const database = await this.open();
    const transaction = database.transaction(REVISION_STORE, "readonly");
    const result = await requestResult(
      transaction.objectStore(REVISION_STORE).get([projectId, revisionId]) as IDBRequest<
        StoredRevisionRecord<StoredMusicProject> | undefined
      >
    );
    await transactionDone(transaction);
    return result ? clone(result) : null;
  }

  async listRevisions(projectId: string): Promise<StoredRevisionRecord<StoredMusicProject>[]> {
    const database = await this.open();
    const transaction = database.transaction(REVISION_STORE, "readonly");
    const records = await requestResult(
      transaction.objectStore(REVISION_STORE).index("projectId").getAll(projectId) as IDBRequest<
        StoredRevisionRecord<StoredMusicProject>[]
      >
    );
    await transactionDone(transaction);
    return records
      .sort((left, right) => right.revision.createdAt.localeCompare(left.revision.createdAt))
      .map(clone);
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction([PROJECT_STORE, REVISION_STORE], "readwrite");
    transaction.objectStore(PROJECT_STORE).clear();
    transaction.objectStore(REVISION_STORE).clear();
    await transactionDone(transaction);
  }
}

export interface LocalProjectRepositoryOptions<P extends StoredMusicProject> {
  /** Snapshot validator; defaults to Project Schema v1. Use parseMusicProjectV2 for plug-in projects. */
  parse?: ProjectSnapshotParser<P>;
}

export class LocalProjectRepository<P extends StoredMusicProject = MusicProject> {
  private readonly parse: ProjectSnapshotParser<P>;

  constructor(
    private readonly storage: LocalProjectStorage,
    options: LocalProjectRepositoryOptions<P> = {}
  ) {
    this.parse = options.parse ?? (parseMusicProjectV1 as ProjectSnapshotParser<P>);
  }

  async save(project: P, revision?: ProjectRevision): Promise<StoredProjectRecord<P>> {
    const record = await createStoredProjectRecord(project, this.parse);
    if (revision) {
      const revisionRecord = await createStoredRevisionRecord(project, revision, this.parse);
      await this.storage.putRevision(revisionRecord);
    }
    await this.storage.putProject(record);
    return clone(record);
  }

  async load(projectId: string): Promise<P | null> {
    const record = await this.storage.getProject(projectId);
    if (!record) {
      return null;
    }
    const verified = await verifyStoredProjectRecord(record, this.parse);
    return clone(verified.project);
  }

  async list(): Promise<StoredProjectSummary[]> {
    return this.storage.listProjects();
  }

  async revisions(projectId: string): Promise<ProjectRevision[]> {
    const records = await this.storage.listRevisions(projectId);
    return records.map((record) => clone(record.revision));
  }

  async loadRevision(projectId: string, revisionId: string): Promise<P | null> {
    const record = await this.storage.getRevision(projectId, revisionId);
    if (!record) {
      return null;
    }
    const checksum = await computeProjectChecksum(record.project);
    if (checksum !== record.revision.checksumSha256) {
      throw new ProjectStorageCorruptionError("Stored revision checksum verification failed.");
    }
    return clone(this.parse(record.project));
  }

  async remove(projectId: string): Promise<void> {
    await this.storage.deleteProject(projectId);
  }
}
