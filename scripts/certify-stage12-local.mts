/**
 * One-command Stage 12 certification run against a Docker deployment:
 *
 *   npm run certify:stage12:local
 *
 * 1. Publishes the certification revision through the studio (asks for the player's email
 *    and password, or reads SYNAPTIX_CERT_EMAIL / SYNAPTIX_CERT_PASSWORD).
 * 2. Runs certify-stage12-render-pipeline.mjs inside the render-worker container for OGG,
 *    MP3, WAV and a repeated WAV, so the worker image's FFmpeg and MinIO view are what's tested.
 * 3. Runs the fail-closed checks that can be automated (wrong service token, expired signed
 *    URL, unavailable revision).
 * 4. Writes the reports, determinism result, build identifiers and a README to
 *    docs/operations/evidence/stage-12-local-<timestamp>/.
 *
 * Optional: STUDIO_URL (default http://localhost:3000), RENDER_WORKER_CONTAINER (default
 * synaptix-music-render-worker-1), BACKEND_CONTAINER (default synaptix_backend_api),
 * BACKEND_REPO (a path, to record the backend commit), STAGE12_EVIDENCE_DIR.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  certificationEnvironment,
  publishCertificationRevision,
  UsageError
} from "./publish-certification-revision.mts";

const WORKER = process.env.RENDER_WORKER_CONTAINER?.trim() || "synaptix-music-render-worker-1";
const BACKEND = process.env.BACKEND_CONTAINER?.trim() || "synaptix_backend_api";
const REMOTE_DIR = "/tmp/stage12-cert";
const RUNS = [
  { name: "ogg", format: "ogg" },
  { name: "mp3", format: "mp3" },
  { name: "wav", format: "wav" },
  { name: "wav-repeat", format: "wav" }
] as const;

interface Artifact { fileName: string; byteLength: number; checksumSha256: string }
interface Report { passed: boolean; certifiedAt: string; jobId: string; outputFormat: string; artifacts: Artifact[] }
interface NegativeChecks { passed: boolean; checks: { name: string; expected: string; observed: string; passed: boolean }[] }

function run(command: string, args: string[], options: { quiet?: boolean } = {}): string {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw new UsageError(`${command} couldn't be started: ${result.error.message}`);
  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    throw new UsageError(`${command} ${args.slice(0, 2).join(" ")} failed:\n${output}`);
  }
  if (!options.quiet && result.stderr.trim()) process.stderr.write(result.stderr);
  return result.stdout;
}

function dockerExec(env: Record<string, string>, command: string[]): string {
  const flags = Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`]);
  return run("docker", ["exec", ...flags, "-w", REMOTE_DIR, WORKER, ...command], { quiet: true });
}

function preflight(): void {
  const state = run("docker", ["inspect", "-f", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}", WORKER]).trim();
  if (!state.startsWith("running")) throw new UsageError(`The render worker (${WORKER}) isn't running: ${state}. Start the stack with sh run-local.sh.`);
  run("docker", ["exec", WORKER, "mkdir", "-p", REMOTE_DIR]);
  const accessKey = dockerExec({}, ["sh", "-c", 'printf %s "$RENDER_WORKER_MINIO_ACCESS_KEY"']).trim();
  if (accessKey === minioRootUser()) {
    throw new UsageError("The render worker is using the MinIO root credentials. Configure the scoped RENDER_WORKER_MINIO_* account (see the Stage 12 runbook) before certifying.");
  }
}

/** The local stack's MinIO root user, from .env.docker (the Compose default otherwise). */
function minioRootUser(): string {
  try {
    const env = readFileSync(".env.docker", "utf8");
    return env.match(/^MINIO_ROOT_USER=(.*)$/m)?.[1]?.trim() || "synaptix_local";
  } catch {
    return "synaptix_local";
  }
}

function gitIdentity(path: string): { commit: string; uncommittedChanges: boolean } | null {
  const commit = spawnSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (commit.status !== 0) return null;
  const status = spawnSync("git", ["-C", path, "status", "--porcelain"], { encoding: "utf8" });
  return { commit: commit.stdout.trim(), uncommittedChanges: status.stdout.trim().length > 0 };
}

function imageId(container: string): string | null {
  const result = spawnSync("docker", ["inspect", "-f", "{{.Image}}", container], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function timestamp(): string {
  return new Date().toISOString().replace(/:\d\d\.\d+Z$/, "").replace("T", "-").replace(":", "");
}

function artifactCell(report: Report): string {
  return report.artifacts
    .map((artifact) => `\`${artifact.fileName}\` ${artifact.byteLength.toLocaleString("en-US")} B \`${artifact.checksumSha256.slice(0, 16)}…\``)
    .join("<br>");
}

function readme(summary: {
  startedAt: string; passed: boolean; build: Record<string, unknown>;
  inputs: Record<string, string>; reports: Record<string, Report>;
  determinism: { masterIdentical: boolean; previewIdentical: boolean }; negative: NegativeChecks;
}): string {
  const music = summary.build.musicRepository as { commit: string; uncommittedChanges: boolean } | null;
  const backend = summary.build.backendRepository as { commit: string; uncommittedChanges: boolean } | null;
  const describe = (repo: { commit: string; uncommittedChanges: boolean } | null) =>
    repo ? `\`${repo.commit}\`${repo.uncommittedChanges ? " **plus uncommitted changes**" : ""}` : "not recorded (set `BACKEND_REPO`)";
  const dirty = Boolean(music?.uncommittedChanges || backend?.uncommittedChanges);
  return `# Stage 12 Certification Evidence: Local Run, ${summary.startedAt}

**Result:** ${summary.passed ? "passed" : "**FAILED**"}. Generated by \`npm run certify:stage12:local\`.

**Scope:** a local Docker deployment, not staging. Whether local evidence closes Stage 12 is the release owner's decision.
${dirty ? "\nOne or more repositories had uncommitted changes, so the commits below don't fully identify the code. Commit, rebuild the images, and run again to tie this evidence to exact commits.\n" : ""}
## Build

| Item | Value |
| --- | --- |
| Music repository | ${describe(music)} |
| Backend repository | ${describe(backend)} |
| Render-worker image | \`${summary.build.renderWorkerImage ?? "unknown"}\` |
| Backend image | \`${summary.build.backendImage ?? "not running as a container"}\` |
| Certified revision | Project \`${summary.inputs.STAGE12_CERT_PROJECT_ID}\`, revision \`${summary.inputs.STAGE12_CERT_REVISION_ID}\`, checksum \`${summary.inputs.STAGE12_CERT_PROJECT_CHECKSUM_SHA256}\` |

## Renders

| Run | Job | Certified at | Artifacts (size, SHA-256 prefix) |
| --- | --- | --- | --- |
${RUNS.map(({ name }) => { const r = summary.reports[name]!; return `| ${name} | \`${r.jobId}\` | ${r.certifiedAt} | ${artifactCell(r)} |`; }).join("\n")}

Every signed download matched its recorded byte length and SHA-256 (full reports: \`report-*.json\`).

**Determinism:** repeated WAV \`master.wav\` ${summary.determinism.masterIdentical ? "byte-identical" : "**DIFFERENT**"}; \`preview.mp3\` ${summary.determinism.previewIdentical ? "byte-identical" : "**DIFFERENT**"}.

## Fail-closed checks

| Check | Expected | Observed | Result |
| --- | --- | --- | --- |
${summary.negative.checks.map((check) => `| ${check.name} | ${check.expected} | ${check.observed.replace(/\|/g, "/")} | ${check.passed ? "pass" : "**FAIL**"} |`).join("\n")}

Not automated here; run them from the runbook when certifying an environment: MinIO scope of the worker account (\`renders/*\` only), backend with no service token (503), credential scan of logs, and shutdown/lease recovery (covered by the worker's PostgreSQL integration tests).
`;
}

async function main(): Promise<void> {
  preflight();
  console.log("Publishing the certification revision…");
  const inputs = certificationEnvironment(await publishCertificationRevision());
  console.log(`  project ${inputs.STAGE12_CERT_PROJECT_ID}, revision checksum ${inputs.STAGE12_CERT_PROJECT_CHECKSUM_SHA256.slice(0, 16)}…`);

  run("docker", ["cp", "scripts/certify-stage12-render-pipeline.mjs", `${WORKER}:${REMOTE_DIR}/certify.mjs`], { quiet: true });
  run("docker", ["cp", "scripts/stage12-negative-checks.mjs", `${WORKER}:${REMOTE_DIR}/negative.mjs`], { quiet: true });

  const startedAt = new Date().toISOString();
  const evidenceDir = process.env.STAGE12_EVIDENCE_DIR?.trim() || join("docs", "operations", "evidence", `stage-12-local-${timestamp()}`);
  await mkdir(evidenceDir, { recursive: true });

  const reports: Record<string, Report> = {};
  for (const { name, format } of RUNS) {
    process.stdout.write(`Rendering ${name}… `);
    dockerExec(
      { ...inputs, RENDER_WORKER_API_URL: "http://127.0.0.1:8200", STAGE12_CERT_OUTPUT_FORMAT: format, STAGE12_CERT_REPORT_PATH: `${REMOTE_DIR}/report-${name}.json` },
      ["node", "certify.mjs"]
    );
    const local = join(evidenceDir, `report-${name}.json`);
    run("docker", ["cp", `${WORKER}:${REMOTE_DIR}/report-${name}.json`, local], { quiet: true });
    reports[name] = JSON.parse(await readFile(local, "utf8")) as Report;
    console.log(reports[name]!.passed ? "passed" : "FAILED");
  }

  const checksum = (name: string, file: string) => reports[name]!.artifacts.find((artifact) => artifact.fileName === file)?.checksumSha256;
  const determinism = {
    masterIdentical: checksum("wav", "master.wav") === checksum("wav-repeat", "master.wav"),
    previewIdentical: checksum("wav", "preview.mp3") === checksum("wav-repeat", "preview.mp3")
  };
  console.log(`Determinism: master ${determinism.masterIdentical ? "identical" : "DIFFERENT"}, preview ${determinism.previewIdentical ? "identical" : "DIFFERENT"}`);

  console.log("Running fail-closed checks (about 30 seconds)…");
  const negative = JSON.parse(dockerExec(
    { RENDER_WORKER_API_URL: "http://127.0.0.1:8200", STAGE12_CERT_PROJECT_ID: inputs.STAGE12_CERT_PROJECT_ID, STAGE12_CERT_REFERENCE_JOB_ID: reports.wav!.jobId },
    ["node", "negative.mjs"]
  ).trim().split("\n").pop()!) as NegativeChecks;
  for (const check of negative.checks) console.log(`  ${check.passed ? "pass" : "FAIL"}  ${check.name}: ${check.observed}`);

  const summary = {
    startedAt,
    passed: RUNS.every(({ name }) => reports[name]!.passed) && determinism.masterIdentical && determinism.previewIdentical && negative.passed,
    build: {
      musicRepository: gitIdentity("."),
      backendRepository: process.env.BACKEND_REPO ? gitIdentity(process.env.BACKEND_REPO) : null,
      renderWorkerImage: imageId(WORKER),
      backendImage: imageId(BACKEND)
    },
    inputs,
    reports,
    determinism,
    negative
  };
  await writeFile(join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(join(evidenceDir, "README.md"), readme(summary), "utf8");
  console.log(`\nStage 12 local certification ${summary.passed ? "PASSED" : "FAILED"}. Evidence: ${evidenceDir}`);
  if (!summary.passed) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof UsageError ? error.message : error);
  process.exitCode = 1;
}
