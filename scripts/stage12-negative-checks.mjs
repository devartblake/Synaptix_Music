// Stage 12 certification, step 7: fail-closed checks run inside the render-worker container,
// so they use the worker's own network, credentials and MinIO client. Prints one JSON object.
//
// Inputs: RENDER_WORKER_API_URL, STAGE12_CERT_PROJECT_ID, STAGE12_CERT_REFERENCE_JOB_ID, plus
// the worker's own SYNAPTIX_PLATFORM_API_URL and RENDER_WORKER_MINIO_* environment.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const env = process.env;
const worker = env.RENDER_WORKER_API_URL.replace(/\/$/, "");
const platform = env.SYNAPTIX_PLATFORM_API_URL.replace(/\/$/, "");
const results = [];

function record(name, expected, observed, passed) {
  results.push({ name, expected, observed, passed });
}

async function wrongServiceToken() {
  const response = await fetch(
    `${platform}/internal/music/projects/${env.STAGE12_CERT_PROJECT_ID}/revisions/any`,
    { headers: { "X-Service-Token": `wrong-${randomUUID()}` } }
  );
  const body = await response.json().catch(() => ({}));
  record("Worker → backend with a wrong service token", "401 ServiceAuthenticationRequired",
    `${response.status} ${body.code ?? ""}`.trim(), response.status === 401 && body.code === "ServiceAuthenticationRequired");
}

async function expiredSignedUrl() {
  const job = await (await fetch(`${worker}/render-jobs/${env.STAGE12_CERT_REFERENCE_JOB_ID}`)).json();
  const artifact = job.result.artifacts.find((item) => item.fileName.startsWith("master."));
  const grant = await (await fetch(`${worker}/render-jobs/${job.jobId}/artifacts/${artifact.artifactId}/download-url`)).json();
  const issued = new URL(grant.downloadUrl);
  const key = decodeURIComponent(issued.pathname.split("/").slice(2).join("/"));
  const Minio = createRequire(`${env.WORKER_APP_DIR ?? "/app"}/package.json`)("minio");
  const client = new Minio.Client({
    endPoint: env.RENDER_WORKER_MINIO_ENDPOINT,
    port: Number(env.RENDER_WORKER_MINIO_PORT),
    useSSL: env.RENDER_WORKER_MINIO_USE_SSL === "true",
    accessKey: env.RENDER_WORKER_MINIO_ACCESS_KEY,
    secretKey: env.RENDER_WORKER_MINIO_SECRET_KEY
  });
  const shortLived = await client.presignedGetObject(env.RENDER_WORKER_MINIO_BUCKET, key, 1);
  const fresh = (await fetch(shortLived)).status;
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const late = await fetch(shortLived);
  const code = ((await late.text()).match(/<Code>([^<]+)/) ?? [])[1] ?? "";
  record("Signed URL used after it expires", "200 while fresh, then 403",
    `${fresh} fresh, ${late.status} ${code} after expiry; worker issues ${issued.searchParams.get("X-Amz-Expires")} s URLs`,
    fresh === 200 && late.status === 403);
}

async function unavailableRevision() {
  const renderId = randomUUID();
  const manifest = {
    contractVersion: "1.0.0", renderId, projectId: env.STAGE12_CERT_PROJECT_ID,
    revisionId: "stage12-revision-that-does-not-exist", projectChecksumSha256: "0".repeat(64),
    engineVersion: "stage12-certification", seed: 42, scope: { kind: "master" },
    range: { startTick: 0, endTick: 3840 },
    output: { format: "wav", sampleRate: 48000, bitDepth: 24, normalizePeakDbfs: -1, includeTailSeconds: 2 },
    requestedAt: new Date().toISOString()
  };
  const submit = await fetch(`${worker}/render-jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `stage12-deadletter-${renderId}` },
    body: JSON.stringify({ manifest, maxAttempts: 2 })
  });
  let job = await submit.json();
  const deadline = Date.now() + 180_000;
  while (!["completed", "failed", "cancelled", "dead_letter"].includes(job.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    job = await (await fetch(`${worker}/render-jobs/${job.jobId}`)).json();
  }
  const events = await (await fetch(`${worker}/render-jobs/${job.jobId}/events`)).json();
  const trail = (events.events ?? events).map((event) => event.type ?? event.eventType ?? event.status).join(" → ");
  const artifacts = job.result?.artifacts?.length ?? 0;
  record("Unavailable revision", "Retries, then dead-letters with no artifacts",
    `${trail}; ${artifacts} artifacts; ${String(job.lastError ?? "").slice(0, 120)}`,
    job.status === "dead_letter" && artifacts === 0);
}

for (const check of [wrongServiceToken, expiredSignedUrl, unavailableRevision]) {
  try {
    await check();
  } catch (error) {
    record(check.name, "Check completes", `Error: ${error instanceof Error ? error.message : error}`, false);
  }
}
console.log(JSON.stringify({ passed: results.every((result) => result.passed), checks: results }));
