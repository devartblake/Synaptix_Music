import { z } from "zod";
import {
  RenderArtifactManifestSchema,
  type RenderJob,
  type AdaptiveGameAudioManifest
} from "@synaptix/render-contracts";
import {
  AdaptivePackageArtifactInputSchema,
  PublishAdaptivePackageRequestSchema
} from "@synaptix/platform-contracts/adaptive-packages";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ReportSchema = z.object({
  certificationVersion: z.literal("1.0.0"),
  passed: z.literal(true),
  certifiedAt: z.string().datetime(),
  renderWorkerApiUrl: z.string().url(),
  jobId: z.string().uuid(),
  renderId: z.string().uuid(),
  projectId: z.string(),
  revisionId: z.string(),
  outputFormat: z.enum(["wav", "mp3", "ogg"]),
  artifactManifestChecksumSha256: hash,
  artifacts: z.array(
    z.object({
      artifactId: z.string().uuid(),
      fileName: z.string(),
      mediaType: z.string(),
      byteLength: z.number().int().nonnegative(),
      checksumSha256: hash
    })
  )
});
export type VerifiedEvidence = {
  jobId: string;
  report: z.infer<typeof ReportSchema>;
  manifestChecksum: string;
};
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyAdaptiveEvidence(
  reportValue: unknown,
  manifestBytes: Uint8Array,
  job: RenderJob
): Promise<VerifiedEvidence> {
  const report = ReportSchema.parse(reportValue);
  const manifest = RenderArtifactManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(manifestBytes))
  );
  const checksum = await sha256(manifestBytes);
  if (
    job.status !== "completed" ||
    job.result?.status !== "completed" ||
    report.jobId !== job.jobId ||
    report.renderId !== job.manifest.renderId ||
    report.projectId !== job.manifest.projectId ||
    report.revisionId !== job.manifest.revisionId
  )
    throw new Error("Certification report does not match this completed render.");
  if (
    checksum !== report.artifactManifestChecksumSha256 ||
    manifest.renderId !== report.renderId ||
    manifest.projectId !== report.projectId ||
    manifest.revisionId !== report.revisionId ||
    manifest.projectChecksumSha256 !== job.manifest.projectChecksumSha256 ||
    manifest.engineVersion !== job.manifest.engineVersion ||
    manifest.outputFormat !== report.outputFormat
  )
    throw new Error(
      "Artifact manifest checksum or revision does not match the certification report."
    );
  const manifestArtifact = job.result.artifacts.find(
    (item) => item.fileName === "artifact-manifest.json"
  );
  if (
    !manifestArtifact ||
    manifestArtifact.checksumSha256 !== checksum ||
    manifestArtifact.byteLength !== manifestBytes.byteLength
  )
    throw new Error("Artifact manifest bytes do not match the completed job.");
  for (const artifact of job.result.artifacts) {
    const evidence = report.artifacts.find((item) => item.artifactId === artifact.artifactId);
    if (
      !evidence ||
      evidence.checksumSha256 !== artifact.checksumSha256 ||
      evidence.byteLength !== artifact.byteLength ||
      evidence.mediaType !== artifact.mediaType ||
      evidence.fileName !== artifact.fileName
    )
      throw new Error("Report artifact evidence does not match the completed job.");
    if (artifact.artifactId !== manifestArtifact.artifactId) {
      const entry = manifest.artifacts.find((item) => item.artifactId === artifact.artifactId);
      if (
        !entry ||
        entry.checksumSha256 !== artifact.checksumSha256 ||
        entry.byteLength !== artifact.byteLength
      )
        throw new Error("Artifact manifest is missing matching artifact evidence.");
    }
  }
  if (
    !manifest.previewArtifactId ||
    !report.artifacts.some(
      (item) => item.artifactId === manifest.previewArtifactId && item.fileName === "preview.mp3"
    )
  )
    throw new Error("Stage 12 evidence must include its certified preview.mp3.");
  return { jobId: job.jobId, report, manifestChecksum: checksum };
}

export function createAdaptivePublication(
  manifest: AdaptiveGameAudioManifest,
  name: string,
  jobs: readonly RenderJob[],
  evidence: readonly VerifiedEvidence[],
  locations: unknown
) {
  const artifacts = z.array(AdaptivePackageArtifactInputSchema).parse(locations);
  const ids = [
    ...new Set(
      manifest.states.flatMap((state) => [state.masterArtifactId, ...state.stemArtifactIds])
    )
  ];
  const selected = ids.map((id) => {
    const job = jobs.find((value) =>
      value.result?.artifacts.some((artifact) => artifact.artifactId === id)
    );
    const proof = evidence.find((value) => value.jobId === job?.jobId);
    const artifact = job?.result?.artifacts.find((value) => value.artifactId === id);
    const location = artifacts.find((value) => value.artifactId === id);
    if (
      !job ||
      !proof ||
      !artifact ||
      !location ||
      job.manifest.projectId !== manifest.projectId ||
      job.manifest.revisionId !== manifest.revisionId ||
      job.manifest.projectChecksumSha256 !== manifest.projectChecksumSha256 ||
      location.checksumSha256 !== artifact.checksumSha256 ||
      location.byteLength !== artifact.byteLength ||
      location.mediaType !== artifact.mediaType
    )
      throw new Error(
        "Every published artifact needs matching certification and a platform storage location."
      );
    const certified = proof.report.artifacts.find((item) => item.artifactId === id);
    if (
      proof.report.renderId !== job.manifest.renderId ||
      proof.report.revisionId !== manifest.revisionId ||
      !certified ||
      certified.checksumSha256 !== artifact.checksumSha256 ||
      certified.byteLength !== artifact.byteLength
    )
      throw new Error(
        "The render changed after evidence verification; reload its certification files."
      );
    return location;
  });
  return PublishAdaptivePackageRequestSchema.parse({
    packageId: manifest.packageId,
    projectId: manifest.projectId,
    revisionId: manifest.revisionId,
    projectChecksumSha256: manifest.projectChecksumSha256,
    name,
    manifest,
    artifacts: selected
  });
}
