import { hostname } from "node:os";

import { Pool } from "pg";

import { createRenderJobHttpServer } from "./http-server.ts";
import { httpProjectLoaderFromEnv } from "./http-project-loader.ts";
import { applyMigrations } from "./migrate.ts";
import { minioArtifactStoreFromEnv } from "./minio-artifact-store.ts";
import { PostgresRenderJobStore } from "./postgres-render-job-store.ts";
import { runWorker } from "./worker.ts";

// Boots the render-job HTTP API and, when platform and object-storage
// credentials are configured, the polling worker for production renders.
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const port = Number(process.env.RENDER_WORKER_HTTP_PORT ?? 8200);

  const pool = new Pool({ connectionString });
  await applyMigrations(pool);

  const store = new PostgresRenderJobStore(pool);
  const artifactStore = minioArtifactStoreFromEnv();
  const projectLoader = httpProjectLoaderFromEnv();
  if (projectLoader && !artifactStore) {
    throw new Error("MinIO artifact storage must be configured before the render worker can run.");
  }
  const server = createRenderJobHttpServer(store, artifactStore ?? undefined);
  const workerAbort = new AbortController();

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`render-worker HTTP API listening on :${port}`);
  console.log(`render-worker artifact delivery ${artifactStore ? "enabled" : "disabled"}`);
  if (projectLoader && artifactStore) {
    const workerId = process.env.RENDER_WORKER_ID ?? `${hostname()}-${process.pid}`;
    void runWorker(store, { loader: projectLoader, sink: artifactStore }, workerId, {
      signal: workerAbort.signal
    });
    console.log(`render-worker polling enabled as '${workerId}'`);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      workerAbort.abort();
      server.close(() => {
        void pool.end().finally(() => process.exit(0));
      });
    });
  }
}

void main();
