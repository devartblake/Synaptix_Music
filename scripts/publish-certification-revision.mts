/**
 * Stage 12 certification, step 4: publish one small, known-good project revision to the
 * SynaptixPlay platform through the studio's own sign-in and sync routes, then print the
 * STAGE12_CERT_* values for `npm run certify:stage12`.
 *
 *   STUDIO_URL=http://localhost:3000 \
 *   SYNAPTIX_CERT_EMAIL=... SYNAPTIX_CERT_PASSWORD=... \
 *   npm run publish:cert-revision
 *
 * Credentials come from the environment only, never arguments, and are never printed.
 * The musical content is fixed, so every run publishes identical music under a new project.
 */
import { randomUUID } from "node:crypto";

import { computeProjectChecksum } from "@synaptix/command-system";
import { createEmptyProject, type MusicProject } from "@synaptix/project-model";

const BARS = 4;
const PPQ = 960;
const TICKS_PER_BAR = PPQ * 4;
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
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

async function main(): Promise<void> {
  const studio = required("STUDIO_URL").replace(/\/$/, "");
  const signIn = await fetch(`${studio}/api/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: required("SYNAPTIX_CERT_EMAIL"), password: required("SYNAPTIX_CERT_PASSWORD") })
  });
  if (!signIn.ok) throw new Error(`Sign-in failed (${signIn.status}): ${(await signIn.json() as { message?: string }).message ?? ""}`);
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
  console.log(`STAGE12_CERT_PROJECT_ID=${project.projectId}`);
  console.log(`STAGE12_CERT_REVISION_ID=${revision.revisionId}`);
  console.log(`STAGE12_CERT_PROJECT_CHECKSUM_SHA256=${checksumSha256}`);
  console.log(`STAGE12_CERT_END_TICK=${BARS * TICKS_PER_BAR}`);
}

await main();
