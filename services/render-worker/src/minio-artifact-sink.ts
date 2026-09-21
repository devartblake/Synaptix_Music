import { Client } from "minio";

import type { RenderedArtifact } from "./offline-renderer.ts";
import type { ArtifactSink } from "./worker.ts";

export interface MinioArtifactSinkOptions {
  endPoint: string;
  port?: number;
  useSSL?: boolean;
  accessKey: string;
  secretKey: string;
  bucket?: string;
  /** Seconds a presigned download URL stays valid. Mirrors the backend's 10-minute upload expiry. */
  downloadUrlExpirySeconds?: number;
}

export const DEFAULT_BUCKET = "synaptix-assets";
export const DEFAULT_DOWNLOAD_URL_EXPIRY_SECONDS = 600;

/**
 * Object key for a render artifact. The `renders/` prefix namespaces this
 * service's objects inside the shared `synaptix-assets` bucket, matching the
 * backend's prefix-as-folder convention (see MediaService's
 * `uploads/{category}/{date}/{guid}_{name}`). The key is fully reconstructible
 * from fields RenderArtifact already carries, so nothing extra is persisted.
 */
export function artifactObjectKey(renderId: string, fileName: string): string {
  return `renders/${renderId}/${fileName}`;
}

/**
 * Durable artifact storage backed by the same MinIO instance the platform
 * backend uses. Credentials should be scoped to `synaptix-assets/renders/*`
 * rather than reusing the backend's broader key.
 */
export class MinioArtifactSink implements ArtifactSink {
  private readonly client: Client;
  private readonly bucket: string;
  private readonly downloadUrlExpirySeconds: number;
  private ensuredBucket = false;

  constructor(options: MinioArtifactSinkOptions) {
    if (!options.endPoint) throw new Error("MinIO endPoint is required.");
    if (!options.accessKey || !options.secretKey) throw new Error("MinIO credentials are required.");

    this.bucket = options.bucket ?? DEFAULT_BUCKET;
    this.downloadUrlExpirySeconds = options.downloadUrlExpirySeconds ?? DEFAULT_DOWNLOAD_URL_EXPIRY_SECONDS;
    this.client = new Client({
      endPoint: options.endPoint,
      ...(options.port === undefined ? {} : { port: options.port }),
      useSSL: options.useSSL ?? false,
      accessKey: options.accessKey,
      secretKey: options.secretKey
    });
  }

  // The bucket is shared with the backend and normally pre-provisioned; this
  // only creates it when missing so local/test runs work against a blank MinIO.
  private async ensureBucket(): Promise<void> {
    if (this.ensuredBucket) return;
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
    }
    this.ensuredBucket = true;
  }

  async store(renderId: string, artifact: RenderedArtifact): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(
      this.bucket,
      artifactObjectKey(renderId, artifact.metadata.fileName),
      artifact.bytes,
      artifact.bytes.length,
      { "Content-Type": artifact.metadata.mediaType }
    );
  }

  async presignedDownloadUrl(renderId: string, fileName: string): Promise<string> {
    return this.client.presignedGetObject(
      this.bucket,
      artifactObjectKey(renderId, fileName),
      this.downloadUrlExpirySeconds
    );
  }
}

/**
 * Builds a sink from environment configuration, or returns null when MinIO is
 * not configured so callers can fall back to local-filesystem storage.
 */
export function minioArtifactSinkFromEnv(env: NodeJS.ProcessEnv = process.env): MinioArtifactSink | null {
  const endPoint = env.RENDER_WORKER_MINIO_ENDPOINT;
  const accessKey = env.RENDER_WORKER_MINIO_ACCESS_KEY;
  const secretKey = env.RENDER_WORKER_MINIO_SECRET_KEY;
  if (!endPoint || !accessKey || !secretKey) return null;

  const port = env.RENDER_WORKER_MINIO_PORT ? Number(env.RENDER_WORKER_MINIO_PORT) : undefined;
  if (port !== undefined && !Number.isInteger(port)) {
    throw new Error("RENDER_WORKER_MINIO_PORT must be an integer.");
  }

  return new MinioArtifactSink({
    endPoint,
    port,
    useSSL: env.RENDER_WORKER_MINIO_USE_SSL === "true",
    accessKey,
    secretKey,
    bucket: env.RENDER_WORKER_MINIO_BUCKET ?? DEFAULT_BUCKET
  });
}
