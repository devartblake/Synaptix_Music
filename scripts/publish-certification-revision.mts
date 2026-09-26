/**
 * Stage 12 certification, step 4: publish one small, known-good project revision to the
 * SynaptixPlay platform through the studio's own sign-in and sync routes, then print the
 * STAGE12_CERT_* values for `npm run certify:stage12`.
 *
 *   npm run publish:cert-revision
 *
 * STUDIO_URL defaults to http://localhost:3000. The player account comes from
 * SYNAPTIX_CERT_EMAIL and SYNAPTIX_CERT_PASSWORD, read from the environment, then the
 * gitignored .env.docker; if neither has them, an interactive terminal asks for them (the
 * password isn't shown). Credentials are never accepted as arguments and never printed.
 * The musical content is fixed, so every run publishes identical music under a new project.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { computeProjectChecksum } from "@synaptix/command-system";
import { createEmptyProject, type MusicProject } from "@synaptix/project-model";

const BARS = 4;
const PPQ = 960;
const TICKS_PER_BAR = PPQ * 4;
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

/** A problem the operator can fix; printed without a stack trace. */
export class UsageError extends Error {}

/** Reads a line from the terminal; with `hidden`, typed characters aren't shown. */
function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const output = rl as unknown as { _writeToOutput(text: string): void };
    const write = output._writeToOutput.bind(rl);
    output._writeToOutput = (text) => write(text.startsWith(question) ? question : "");
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    })
  );
}

/** A value from the gitignored local-stack settings file, .env.docker, if present. */
function localSetting(name: string): string | undefined {
  try {
    const line = readFileSync(".env.docker", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    return line?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * A setting from the environment, then .env.docker, then a prompt when running in an
 * interactive terminal.
 */
export async function setting(name: string, prompt: string, hidden = false): Promise<string> {
  const value = process.env[name]?.trim() || localSetting(name);
  if (value) return value;
  if (process.stdin.isTTY) {
    const answer = await ask(prompt, hidden);
    if (answer) return answer;
  }
  throw new UsageError(`${name} is required. Set it in the environment, or run in a terminal to be asked for it.`);
}

/** Drums and a four-chord synth part: enough to exercise instruments, sends and the master. */
export function certificationProject(projectId: string): MusicProject {
  const project = createEmptyProject(projectId, {
    name: "Stage 12 Certification",
    revisionId: `${projectId}-cert-1`,
    now: FIXED_TIME
  });
  project.transport.loopRange = { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: BARS * TICKS_PER_BAR };
  const parts = [
    { name: "Drums", device: "synaptix-drum-synth", pitches: [36, 42, 38, 42], volumeDb: -6 },
    { name: "Harmony", device: "synaptix-poly-synth", pitches: [57, 60, 64, 67], volumeDb: -10 }
  ];
  project.tracks = parts.map((part, index) => ({
    id: `track-${index + 1}`,
    name: part.name,
    kind: "instrument" as const,
    muted: false,
    solo: false,
    volumeDb: part.volumeDb,
    pan: 0,
    reverbSend: index === 1 ? 0.2 : 0,
    devices: [{ id: `device-${index + 1}`, deviceType: part.device, deviceVersion: "1.0.0", enabled: true, parameters: [] }],
    clips: [{
      id: `clip-${index + 1}`,
      kind: "midi" as const,
      name: `${part.name} Certification`,
      range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: BARS * TICKS_PER_BAR },
      loop: false,
      notes: Array.from({ length: BARS }, (_, bar) => part.pitches.map((pitch, beat) => ({
        id: `note-${index}-${bar}-${beat}`,
        pitch,
        velocity: beat === 0 ? 110 : 90,
        startTick: bar * TICKS_PER_BAR + beat * PPQ,
        durationTicks: PPQ - 120
      }))).flat()
    }]
  }));
  return project;
}

export interface CertificationInputs {
  projectId: string;
  revisionId: string;
  checksumSha256: string;
  endTick: number;
}

/** The STAGE12_CERT_* environment for `certify-stage12-render-pipeline.mjs`. */
export function certificationEnvironment(inputs: CertificationInputs): Record<string, string> {
  return {
    STAGE12_CERT_PROJECT_ID: inputs.projectId,
    STAGE12_CERT_REVISION_ID: inputs.revisionId,
    STAGE12_CERT_PROJECT_CHECKSUM_SHA256: inputs.checksumSha256,
    STAGE12_CERT_END_TICK: String(inputs.endTick)
  };
}

/** Signs in through the studio, uploads the certification project, and verifies the stored copy. */
export async function publishCertificationRevision(): Promise<CertificationInputs> {
  const studio = (process.env.STUDIO_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  const email = await setting("SYNAPTIX_CERT_EMAIL", "SynaptixPlay email: ");
  const password = await setting("SYNAPTIX_CERT_PASSWORD", "SynaptixPlay password: ", true);
  let signIn: Response;
  try {
    signIn = await fetch(`${studio}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
  } catch {
    throw new UsageError(`The studio at ${studio} couldn't be reached. Start it (sh run-local.sh) or set STUDIO_URL.`);
  }
  if (!signIn.ok) {
    const message = (await signIn.json().catch(() => ({})) as { message?: string }).message;
    throw new UsageError(`Sign-in failed (${signIn.status}): ${message ?? "no details"}`);
  }
  const cookie = signIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");

  const project = certificationProject(randomUUID());
  const checksumSha256 = await computeProjectChecksum(project);
  const revision = {
    revisionId: project.revisionId,
    parentRevisionId: null,
    transactionId: `stage12-cert-${project.projectId}`,
    commandIds: [],
    createdAt: FIXED_TIME,
    checksumSha256
  };
  const path = `${studio}/api/platform/projects/${project.projectId}/revisions/${encodeURIComponent(revision.revisionId)}`;
  const upload = await fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json", "idempotency-key": `stage12-cert:${project.projectId}`, cookie },
    body: JSON.stringify({
      projectId: project.projectId,
      revisionId: revision.revisionId,
      parentRevisionId: null,
      name: project.metadata.name,
      checksumSha256,
      revision,
      project
    })
  });
  if (!upload.ok) throw new Error(`Revision upload failed (${upload.status}): ${await upload.text()}`);

  // Read it back through the platform to prove the stored snapshot is the one certified.
  const stored = await fetch(`${studio}/api/platform/projects/${project.projectId}`, { headers: { cookie } });
  const body = await stored.json() as { project?: MusicProject; revisionId?: string };
  if (!stored.ok || !body.project || (await computeProjectChecksum(body.project)) !== checksumSha256)
    throw new Error("The platform's stored revision does not match what was uploaded.");

  await fetch(`${studio}/api/auth/session`, { method: "DELETE", headers: { cookie } });
  return { projectId: project.projectId, revisionId: revision.revisionId, checksumSha256, endTick: BARS * TICKS_PER_BAR };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const inputs = await publishCertificationRevision();
    for (const [name, value] of Object.entries(certificationEnvironment(inputs))) console.log(`${name}=${value}`);
  } catch (error) {
    console.error(error instanceof UsageError ? error.message : error);
    process.exitCode = 1;
  }
}
