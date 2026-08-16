import type { MusicProject } from "@synaptix/project-model";
import type { RenderJob } from "@synaptix/render-contracts";

import { renderProjectOffline, type RenderedArtifact } from "./offline-renderer.ts";
import type { PostgresRenderJobStore } from "./postgres-render-job-store.ts";

/**
 * Fetches the exact project revision a render manifest references. No
 * implementation is provided by this package: the real implementation calls
 * the SynaptixPlay platform backend and needs a service-to-service
 * authentication strategy that has not been decided yet (the existing BFF
 * routes only ever forward an end user's own session, which a background
 * worker does not have). Until that's designed, callers must supply their
 * own loader (e.g. a fixture-backed one for local/manual runs).
 */
export interface ProjectLoader {
  loadProject(projectId: string, revisionId: string): Promise<MusicProject>;
}

export interface ArtifactSink {
  store(renderId: string, artifact: RenderedArtifact): Promise<void>;
}

export interface WorkerDependencies {
  loader: ProjectLoader;
  sink: ArtifactSink;
}

export interface ProcessJobOptions {
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
}

/**
 * Leases at most one job and renders it: load the exact project revision,
 * render offline, persist artifacts, then report success or failure back to
 * the store (which applies the shared retry/dead-letter rules). A heartbeat
 * runs for the duration of the render so a slow render doesn't get reclaimed
 * as an expired lease by another worker. Returns null when no job was
 * available to lease.
 */
export async function processNextJob(
  store: PostgresRenderJobStore,
  dependencies: WorkerDependencies,
  workerId: string,
  options: ProcessJobOptions = {}
): Promise<RenderJob | null> {
  const job = await store.lease(workerId, options.leaseDurationMs);
  if (!job) return null;

  const heartbeatIntervalMs = options.heartbeatIntervalMs
    ?? Math.max(1000, Math.floor((options.leaseDurationMs ?? 60_000) / 3));
  const heartbeat = setInterval(() => {
    void store.heartbeat(job.jobId, workerId, options.leaseDurationMs).catch(() => {
      // A failed heartbeat means the lease may already be gone (reclaimed by
      // another worker); the eventual reportResult/fail call below surfaces
      // that, so there is nothing actionable to do here.
    });
  }, heartbeatIntervalMs);

  try {
    const project = await dependencies.loader.loadProject(job.manifest.projectId, job.manifest.revisionId);
    const outcome = renderProjectOffline(project, job.manifest);
    for (const artifact of outcome.artifacts) {
      await dependencies.sink.store(job.manifest.renderId, artifact);
    }
    return await store.reportResult(job.jobId, workerId, outcome.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed with an unknown error.";
    return await store.fail(job.jobId, workerId, message);
  } finally {
    clearInterval(heartbeat);
  }
}

export interface RunWorkerOptions extends ProcessJobOptions {
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

// Production entry point: polls for jobs until aborted. processNextJob above
// is the unit of behavior that's actually tested; this is a thin loop around it.
export async function runWorker(
  store: PostgresRenderJobStore,
  dependencies: WorkerDependencies,
  workerId: string,
  options: RunWorkerOptions = {}
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  while (!options.signal?.aborted) {
    const job = await processNextJob(store, dependencies, workerId, options);
    if (!job && !options.signal?.aborted) {
      await sleep(pollIntervalMs, options.signal);
    }
  }
}
