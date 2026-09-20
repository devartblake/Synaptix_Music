import { Client } from "minio";

import type { RenderedArtifact } from "./offline-renderer.ts";
import type { ArtifactSink } from "./worker.ts";

export interface ArtifactDelivery {
  createDownloadUrl(renderId: string, fileName: string, expiresSeconds?: number): Promise<string>;
}

export interface MinioArtifactStoreOptions {
  endpoint: string;
  port?: number;
  useSSL?: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
  downloadExpirySeconds?: number;
}

export interface MinioClientLike {
  putObject(
    bucketName: string,
    objectName: string,
    value: Buffer,
    size: number,
    metadata?: Record<string, string>
  ): Promise<unknown>;
  presignedGetObject(bucketName: string, objectName: string, expires?: number): Promise<string>;
}

function safeSegment(value: string, label: string): string {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error(`${label} must be one safe path segment.`);
  }
  return value;
}

export function renderArtifactObjectName(renderId: string, fileName: string): string {
  return `renders/${safeSegment(renderId, "renderId")}/${safeSegment(fileName, "fileName")}`;
}

/** Durable S3-compatible artifact storage and short-lived signed delivery. */
export class MinioArtifactStore implements ArtifactSink, ArtifactDelivery {
  private readonly client: MinioClientLike;
  private readonly bucket: string;
  private readonly downloadExpirySeconds: number;

  constructor(options: MinioArtifactStoreOptions, client?: MinioClientLike) {
    this.bucket = options.bucket;
    this.downloadExpirySeconds = options.downloadExpirySeconds ?? 900;
    if (
      !Number.isInteger(this.downloadExpirySeconds) ||
      this.downloadExpirySeconds < 1 ||
      this.downloadExpirySeconds > 604800
    ) {
      throw new Error("downloadExpirySeconds must be between 1 and 604800 seconds.");
    }
    this.client =
      client ??
      new Client({
        endPoint: options.endpoint,
        port: options.port,
        useSSL: options.useSSL ?? false,
        accessKey: options.accessKey,
        secretKey: options.secretKey,
        region: options.region
      });
  }

  async store(renderId: string, artifact: RenderedArtifact): Promise<void> {
    if (artifact.metadata.renderId !== renderId) {
      throw new Error(
        `Artifact renderId '${artifact.metadata.renderId}' does not match '${renderId}'.`
      );
    }
    const objectName = renderArtifactObjectName(renderId, artifact.metadata.fileName);
    await this.client.putObject(this.bucket, objectName, artifact.bytes, artifact.bytes.length, {
      "Content-Type": artifact.metadata.mediaType,
      "X-Amz-Meta-Artifact-Id": artifact.metadata.artifactId,
      "X-Amz-Meta-Sha256": artifact.metadata.checksumSha256
    });
  }

  async createDownloadUrl(
    renderId: string,
    fileName: string,
    expiresSeconds = this.downloadExpirySeconds
  ): Promise<string> {
    if (
      !Number.isInteger(expiresSeconds) ||
      expiresSeconds < 1 ||
      expiresSeconds > this.downloadExpirySeconds
    ) {
      throw new Error(`expiresSeconds must be between 1 and ${this.downloadExpirySeconds}.`);
    }
    return this.client.presignedGetObject(
      this.bucket,
      renderArtifactObjectName(renderId, fileName),
      expiresSeconds
    );
  }
}

export function minioArtifactStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env
): MinioArtifactStore | null {
  const endpoint = env.RENDER_WORKER_MINIO_ENDPOINT;
  const accessKey = env.RENDER_WORKER_MINIO_ACCESS_KEY;
  const secretKey = env.RENDER_WORKER_MINIO_SECRET_KEY;
  if (!endpoint && !accessKey && !secretKey) return null;
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error(
      "RENDER_WORKER_MINIO_ENDPOINT, RENDER_WORKER_MINIO_ACCESS_KEY, and RENDER_WORKER_MINIO_SECRET_KEY must be configured together."
    );
  }

  return new MinioArtifactStore({
    endpoint,
    port: env.RENDER_WORKER_MINIO_PORT ? Number(env.RENDER_WORKER_MINIO_PORT) : undefined,
    useSSL: env.RENDER_WORKER_MINIO_USE_SSL === "true",
    accessKey,
    secretKey,
    bucket: env.RENDER_WORKER_MINIO_BUCKET ?? "synaptix-assets",
    region: env.RENDER_WORKER_MINIO_REGION,
    downloadExpirySeconds: env.RENDER_WORKER_SIGNED_URL_TTL_SECONDS
      ? Number(env.RENDER_WORKER_SIGNED_URL_TTL_SECONDS)
      : undefined
  });
}
