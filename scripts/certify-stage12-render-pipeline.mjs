import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const required = [
  "RENDER_WORKER_API_URL",
  "STAGE12_CERT_PROJECT_ID",
  "STAGE12_CERT_REVISION_ID",
  "STAGE12_CERT_PROJECT_CHECKSUM_SHA256"
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required for Stage 12 certification.`);
}

const ffmpeg = spawnSync(
  process.env.RENDER_WORKER_FFMPEG_PATH ?? "ffmpeg",
  ["-hide_banner", "-encoders"],
  { encoding: "utf8" }
);
if (
  ffmpeg.status !== 0 ||
  !ffmpeg.stdout.includes("libmp3lame") ||
  !ffmpeg.stdout.includes("libvorbis")
) {
  throw new Error("FFmpeg with libmp3lame and libvorbis encoders is required.");
}

const baseUrl = process.env.RENDER_WORKER_API_URL.replace(/\/$/, "");
const outputFormat = process.env.STAGE12_CERT_OUTPUT_FORMAT ?? "ogg";
if (!["wav", "mp3", "ogg"].includes(outputFormat)) {
  throw new Error("STAGE12_CERT_OUTPUT_FORMAT must be wav, mp3, or ogg.");
}
const renderId = randomUUID();
const requestedAt = new Date().toISOString();
const manifest = {
  contractVersion: "1.0.0",
  renderId,
  projectId: process.env.STAGE12_CERT_PROJECT_ID,
  revisionId: process.env.STAGE12_CERT_REVISION_ID,
  projectChecksumSha256: process.env.STAGE12_CERT_PROJECT_CHECKSUM_SHA256,
  engineVersion: process.env.STAGE12_CERT_ENGINE_VERSION ?? "stage12-certification",
  seed: 42,
  scope: { kind: "master" },
  range: {
    startTick: Number(process.env.STAGE12_CERT_START_TICK ?? 0),
    endTick: Number(process.env.STAGE12_CERT_END_TICK ?? 3840)
  },
  output: {
    format: outputFormat,
    sampleRate: 48000,
    bitDepth: 24,
    normalizePeakDbfs: -1,
    includeTailSeconds: 2,
    lossyBitrateKbps: 192,
    preview: { format: "mp3", bitrateKbps: 96, maxDurationSeconds: 30 }
  },
  requestedAt
};

const submit = await fetch(`${baseUrl}/render-jobs`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": `stage12-cert-${renderId}`
  },
  body: JSON.stringify({ manifest })
});
if (!submit.ok)
  throw new Error(`Render submission failed (${submit.status}): ${await submit.text()}`);
const submitted = await submit.json();

const deadline = Date.now() + Number(process.env.STAGE12_CERT_TIMEOUT_MS ?? 300000);
let job = submitted;
while (!["completed", "failed", "cancelled", "dead_letter"].includes(job.status)) {
  if (Date.now() >= deadline) throw new Error(`Timed out waiting for render job '${job.jobId}'.`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const response = await fetch(`${baseUrl}/render-jobs/${job.jobId}`);
  if (!response.ok)
    throw new Error(`Render status failed (${response.status}): ${await response.text()}`);
  job = await response.json();
}
if (job.status !== "completed")
  throw new Error(
    `Certification render ended as '${job.status}': ${job.lastError ?? "unknown error"}`
  );

const evidence = [];
let artifactManifest = null;
for (const artifact of job.result.artifacts) {
  const grant = await fetch(
    `${baseUrl}/render-jobs/${job.jobId}/artifacts/${artifact.artifactId}/download-url`
  );
  if (!grant.ok)
    throw new Error(`Download grant failed for '${artifact.fileName}' (${grant.status}).`);
  const { downloadUrl } = await grant.json();
  const download = await fetch(downloadUrl);
  if (!download.ok)
    throw new Error(`Artifact download failed for '${artifact.fileName}' (${download.status}).`);
  const bytes = Buffer.from(await download.arrayBuffer());
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  if (checksumSha256 !== artifact.checksumSha256 || bytes.length !== artifact.byteLength) {
    throw new Error(`Artifact evidence mismatch for '${artifact.fileName}'.`);
  }
  if (artifact.fileName === "artifact-manifest.json")
    artifactManifest = JSON.parse(bytes.toString("utf8"));
  evidence.push({
    artifactId: artifact.artifactId,
    fileName: artifact.fileName,
    mediaType: artifact.mediaType,
    byteLength: bytes.length,
    checksumSha256
  });
}
if (!artifactManifest)
  throw new Error("Certification render did not produce artifact-manifest.json.");
if (!evidence.some((artifact) => artifact.fileName === "preview.mp3")) {
  throw new Error("Certification render did not produce preview.mp3.");
}

const report = {
  certificationVersion: "1.0.0",
  passed: true,
  certifiedAt: new Date().toISOString(),
  renderWorkerApiUrl: baseUrl,
  jobId: job.jobId,
  renderId,
  projectId: manifest.projectId,
  revisionId: manifest.revisionId,
  outputFormat,
  artifacts: evidence,
  artifactManifestChecksumSha256: evidence.find(
    (item) => item.fileName === "artifact-manifest.json"
  ).checksumSha256
};
const outputPath = process.env.STAGE12_CERT_REPORT_PATH ?? "stage12-certification-report.json";
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Stage 12 certification passed. Evidence: ${outputPath}`);
