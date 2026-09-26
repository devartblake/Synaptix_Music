/*
 * Local media for listening: custom cover art and render files cached for offline playback.
 *
 * Kept outside project records on purpose: images and audio are large binary blobs that must
 * not enter project revisions, checksums, or platform uploads. Everything here is per-browser
 * and can be rebuilt (covers re-uploaded, renders re-downloaded).
 */

export const MEDIA_DATABASE_NAME = "synaptix-music-media";
const MEDIA_DATABASE_VERSION = 1;
const ARTWORK_STORE = "artwork";
const RENDER_STORE = "renders";

export interface ProjectArtworkRecord {
  projectId: string;
  blob: Blob;
  mediaType: string;
  width: number;
  height: number;
  updatedAt: string;
}

export interface CachedRenderRecord {
  artifactId: string;
  renderId: string;
  jobId: string;
  projectId: string;
  revisionId: string;
  fileName: string;
  mediaType: string;
  byteLength: number;
  checksumSha256: string;
  durationSeconds: number;
  blob: Blob;
  cachedAt: string;
}

export type CachedRenderSummary = Omit<CachedRenderRecord, "blob">;

export interface MediaStore {
  getArtwork(projectId: string): Promise<ProjectArtworkRecord | null>;
  putArtwork(record: ProjectArtworkRecord): Promise<void>;
  deleteArtwork(projectId: string): Promise<void>;
  getRender(artifactId: string): Promise<CachedRenderRecord | null>;
  listRenders(projectId?: string): Promise<CachedRenderSummary[]>;
  putRender(record: CachedRenderRecord): Promise<void>;
  deleteRender(artifactId: string): Promise<void>;
}

function summary({ blob: _blob, ...rest }: CachedRenderRecord): CachedRenderSummary {
  return rest;
}

function newestFirst(left: CachedRenderSummary, right: CachedRenderSummary): number {
  return right.cachedAt.localeCompare(left.cachedAt);
}

export class InMemoryMediaStore implements MediaStore {
  private readonly artwork = new Map<string, ProjectArtworkRecord>();
  private readonly renders = new Map<string, CachedRenderRecord>();

  async getArtwork(projectId: string) { return this.artwork.get(projectId) ?? null; }
  async putArtwork(record: ProjectArtworkRecord) { this.artwork.set(record.projectId, record); }
  async deleteArtwork(projectId: string) { this.artwork.delete(projectId); }
  async getRender(artifactId: string) { return this.renders.get(artifactId) ?? null; }
  async listRenders(projectId?: string) {
    return [...this.renders.values()]
      .filter((record) => projectId === undefined || record.projectId === projectId)
      .map(summary)
      .sort(newestFirst);
  }
  async putRender(record: CachedRenderRecord) { this.renders.set(record.artifactId, record); }
  async deleteRender(artifactId: string) { this.renders.delete(artifactId); }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Media storage request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Media storage transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Media storage transaction failed."));
  });
}

export class IndexedDbMediaStore implements MediaStore {
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: { databaseName?: string; indexedDB?: IDBFactory } = {}) {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) throw new Error("IndexedDB is not available in this runtime.");
    this.factory = factory;
    this.databaseName = options.databaseName ?? MEDIA_DATABASE_NAME;
  }

  private open(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, MEDIA_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(ARTWORK_STORE)) {
          database.createObjectStore(ARTWORK_STORE, { keyPath: "projectId" });
        }
        if (!database.objectStoreNames.contains(RENDER_STORE)) {
          database.createObjectStore(RENDER_STORE, { keyPath: "artifactId" }).createIndex("projectId", "projectId");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open media storage."));
      request.onblocked = () => reject(new Error("Media storage upgrade is blocked by another tab."));
    });
    return this.databasePromise;
  }

  private async read<T>(storeName: string, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const transaction = (await this.open()).transaction(storeName, "readonly");
    const result = await requestResult(operation(transaction.objectStore(storeName)));
    await transactionDone(transaction);
    return result;
  }

  private async write(storeName: string, operation: (store: IDBObjectStore) => void): Promise<void> {
    const transaction = (await this.open()).transaction(storeName, "readwrite");
    operation(transaction.objectStore(storeName));
    await transactionDone(transaction);
  }

  async getArtwork(projectId: string): Promise<ProjectArtworkRecord | null> {
    return (await this.read(ARTWORK_STORE, (store) => store.get(projectId) as IDBRequest<ProjectArtworkRecord | undefined>)) ?? null;
  }

  putArtwork(record: ProjectArtworkRecord): Promise<void> {
    return this.write(ARTWORK_STORE, (store) => store.put(record));
  }

  deleteArtwork(projectId: string): Promise<void> {
    return this.write(ARTWORK_STORE, (store) => store.delete(projectId));
  }

  async getRender(artifactId: string): Promise<CachedRenderRecord | null> {
    return (await this.read(RENDER_STORE, (store) => store.get(artifactId) as IDBRequest<CachedRenderRecord | undefined>)) ?? null;
  }

  async listRenders(projectId?: string): Promise<CachedRenderSummary[]> {
    const records = await this.read(RENDER_STORE, (store) =>
      (projectId === undefined ? store.getAll() : store.index("projectId").getAll(projectId)) as IDBRequest<CachedRenderRecord[]>
    );
    return records.map(summary).sort(newestFirst);
  }

  putRender(record: CachedRenderRecord): Promise<void> {
    return this.write(RENDER_STORE, (store) => store.put(record));
  }

  deleteRender(artifactId: string): Promise<void> {
    return this.write(RENDER_STORE, (store) => store.delete(artifactId));
  }
}

/** Lowercase hex SHA-256 of a blob's bytes. */
export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class RenderIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderIntegrityError";
  }
}

/**
 * Store a downloaded render only if its bytes match the checksum and size the render worker
 * recorded, so a truncated or tampered download can never be played "offline".
 */
export async function cacheVerifiedRender(
  store: MediaStore,
  metadata: Omit<CachedRenderRecord, "blob" | "cachedAt">,
  blob: Blob,
  now: () => string = () => new Date().toISOString()
): Promise<CachedRenderSummary> {
  if (blob.size !== metadata.byteLength) {
    throw new RenderIntegrityError(`Downloaded ${blob.size} bytes; the render has ${metadata.byteLength}.`);
  }
  if ((await sha256Blob(blob)) !== metadata.checksumSha256) {
    throw new RenderIntegrityError("The downloaded file does not match the render's checksum.");
  }
  const record: CachedRenderRecord = { ...metadata, blob, cachedAt: now() };
  await store.putRender(record);
  return summary(record);
}
