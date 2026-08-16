import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { createEmptyProject, type MusicProject, type Track } from "@synaptix/project-model";
import { RENDER_CONTRACT_VERSION, type RenderManifest } from "@synaptix/render-contracts";
import { Pool } from "pg";

import { applyMigrations } from "./migrate.ts";
import type { RenderedArtifact } from "./offline-renderer.ts";
import { PostgresRenderJobStore } from "./postgres-render-job-store.ts";
import { processNextJob, type ArtifactSink, type ProjectLoader } from "./worker.ts";

const connectionString = process.env.RENDER_WORKER_TEST_DATABASE_URL;
const PPQ = 960;

function testTrack(): Track {
  return {
    id: "track-1",
    name: "Lead",
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: 0,
    pan: 0,
    devices: [{ id: "device-1", deviceType: "synaptix-lead-synth", deviceVersion: "1.0.0", enabled: true, parameters: [] }],
    clips: [{
      id: "clip-1",
      kind: "midi",
      name: "clip",
      range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: PPQ * 4 },
      loop: false,
      notes: [{ id: "note-1", pitch: 60, velocity: 100, startTick: 0, durationTicks: PPQ }]
    }]
  };
}

function testProject(projectId: string, revisionId: string, tracks: Track[] = [testTrack()]): MusicProject {
  const project = createEmptyProject(projectId, { revisionId });
  project.tracks = tracks;
  return project;
}

function manifest(renderId: string, projectId: string, revisionId: string): RenderManifest {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId,
    projectId,
    revisionId,
    projectChecksumSha256: "a".repeat(64),
    engineVersion: "1.0.0",
    seed: 42,
    scope: { kind: "master" },
    range: { startTick: 0, endTick: PPQ * 4 },
    output: { format: "wav", sampleRate: 44100, bitDepth: 16, normalizePeakDbfs: null, includeTailSeconds: 0.1 },
    requestedAt: "2026-08-15T00:00:00.000Z"
  };
}

class FixtureProjectLoader implements ProjectLoader {
  constructor(private readonly project: MusicProject, private readonly delayMs = 0) {}
  async loadProject(): Promise<MusicProject> {
    if (this.delayMs > 0) await sleep(this.delayMs);
    return this.project;
  }
}

class FailingProjectLoader implements ProjectLoader {
  async loadProject(): Promise<MusicProject> {
    throw new Error("Project revision could not be loaded.");
  }
}

class RecordingArtifactSink implements ArtifactSink {
  readonly stored: { renderId: string; fileName: string; byteLength: number }[] = [];
  async store(renderId: string, artifact: RenderedArtifact): Promise<void> {
    this.stored.push({ renderId, fileName: artifact.metadata.fileName, byteLength: artifact.bytes.length });
  }
}

if (!connectionString) {
  test("render worker loop (skipped: set RENDER_WORKER_TEST_DATABASE_URL to run against a real database)", () => {});
} else {
  const pool = new Pool({ connectionString });
  const store = new PostgresRenderJobStore(pool);

  before(async () => {
    await applyMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE render_job_events, render_jobs");
  });

  after(async () => {
    await pool.end();
  });

  test("processNextJob returns null when the queue is empty", async () => {
    const sink = new RecordingArtifactSink();
    const result = await processNextJob(store, { loader: new FixtureProjectLoader(testProject("p", "r")), sink }, "worker-1");
    assert.equal(result, null);
  });

  test("a successful render completes the job and stores its artifact", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const project = testProject("project-a", "revision-a");
    await store.submit(manifest(renderId, "project-a", "revision-a"), "key-1");

    const sink = new RecordingArtifactSink();
    const outcome = await processNextJob(store, { loader: new FixtureProjectLoader(project), sink }, "worker-1");

    assert.equal(outcome?.status, "completed");
    assert.equal(outcome?.result?.artifacts.length, 1);
    assert.equal(sink.stored.length, 1);
    assert.equal(sink.stored[0]?.renderId, renderId);
    assert.equal(sink.stored[0]?.fileName, "master.wav");
    assert.ok(sink.stored[0]!.byteLength > 44, "wrote real audio data, not just a header");
  });

  test("a loader failure fails the job through the store's retry rules", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    await store.submit(manifest(renderId, "project-a", "revision-a"), "key-1", 1);

    const sink = new RecordingArtifactSink();
    const outcome = await processNextJob(store, { loader: new FailingProjectLoader(), sink }, "worker-1");

    assert.equal(outcome?.status, "dead_letter");
    assert.equal(outcome?.lastError, "Project revision could not be loaded.");
    assert.equal(sink.stored.length, 0);
  });

  test("a renderer failure (manifest/project mismatch) fails the job", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    await store.submit(manifest(renderId, "project-a", "revision-a"), "key-1", 1);
    const wrongProject = testProject("project-a", "a-different-revision");

    const sink = new RecordingArtifactSink();
    const outcome = await processNextJob(store, { loader: new FixtureProjectLoader(wrongProject), sink }, "worker-1");

    assert.equal(outcome?.status, "dead_letter");
    assert.match(outcome?.lastError ?? "", /does not match project revision/);
  });

  test("heartbeats keep a slow render's lease alive so it is not reclaimed mid-render", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const project = testProject("project-a", "revision-a");
    await store.submit(manifest(renderId, "project-a", "revision-a"), "key-1");

    const sink = new RecordingArtifactSink();
    const slowLoader = new FixtureProjectLoader(project, 220);

    const [outcome, reclaimedDuringRender] = await Promise.all([
      processNextJob(store, { loader: slowLoader, sink }, "worker-1", { leaseDurationMs: 100, heartbeatIntervalMs: 40 }),
      (async () => {
        await sleep(130);
        return store.reclaimExpiredLeases();
      })()
    ]);

    assert.equal(reclaimedDuringRender.length, 0, "heartbeat should have renewed the lease before it expired");
    assert.equal(outcome?.status, "completed");
  });
}
