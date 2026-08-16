import { Pool } from "pg";

import { createRenderJobHttpServer } from "./http-server.ts";
import { applyMigrations } from "./migrate.ts";
import { PostgresRenderJobStore } from "./postgres-render-job-store.ts";

// Boots the render-job HTTP API. Does not start the worker polling loop:
// runWorker() needs a real ProjectLoader that fetches an exact project
// revision from the SynaptixPlay platform backend, and that requires a
// service-to-service authentication strategy that hasn't been designed yet
// (see worker.ts). Wire runWorker() in here once that loader exists.
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const port = Number(process.env.RENDER_WORKER_HTTP_PORT ?? 8200);

  const pool = new Pool({ connectionString });
  await applyMigrations(pool);

  const store = new PostgresRenderJobStore(pool);
  const server = createRenderJobHttpServer(store);

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`render-worker HTTP API listening on :${port}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => {
        void pool.end().finally(() => process.exit(0));
      });
    });
  }
}

void main();
