"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { AdaptiveGameAudioManifest, RenderJob } from "@synaptix/render-contracts";
import {
  AdaptivePackagePublishResponseSchema,
  AdaptivePackageRevokeResponseSchema,
  AdaptivePackageVersionListSchema,
  AdaptivePackageVersionSchema
} from "@synaptix/platform-contracts/adaptive-packages";
import {
  createAdaptivePublication,
  sha256,
  verifyAdaptiveEvidence,
  type VerifiedEvidence
} from "../../../lib/platform/adaptive-evidence";
import { platformRequest } from "../../../lib/platform/platform-request";
import { Button } from "../../../components/ui/StudioControls";

export function AdaptivePublication({
  manifest,
  jobs,
  packageId
}: {
  manifest: AdaptiveGameAudioManifest | null;
  jobs: RenderJob[];
  packageId: string;
}) {
  const [name, setName] = useState("Adaptive music");
  const [evidence, setEvidence] = useState<VerifiedEvidence[]>([]);
  const [locations, setLocations] = useState<unknown>(null);
  const [report, setReport] = useState<File | null>(null);
  const [artifactManifest, setArtifactManifest] = useState<File | null>(null);
  const [message, setMessage] = useState(
    "Load a certification report and its original artifact-manifest.json for each selected render."
  );
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<z.infer<typeof AdaptivePackageVersionListSchema>>([]);
  const [version, setVersion] = useState<unknown>(null);
  const [versionMessage, setVersionMessage] = useState("Loading version history…");
  const [refresh, setRefresh] = useState(0);
  const [revokeReason, setRevokeReason] = useState("");
  let payload: ReturnType<typeof createAdaptivePublication> | null = null;
  let gate = "A valid draft is required.";
  try {
    if (manifest) {
      payload = createAdaptivePublication(manifest, name, jobs, evidence, locations);
      gate = "Artifact evidence matches. Platform authorization is checked on publication.";
    }
  } catch (cause) {
    gate = locations
      ? cause instanceof Error
        ? cause.message
        : "Evidence incomplete."
      : "Verified evidence and platform artifact locations are required.";
  }
  useEffect(() => {
    const controller = new AbortController();
    void platformRequest(`adaptive-packages/${encodeURIComponent(packageId)}/versions`, {
      signal: controller.signal
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setVersions(AdaptivePackageVersionListSchema.parse(value));
          setVersionMessage("Version history is up to date.");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setVersionMessage(
            `Version history unavailable: ${cause instanceof Error ? cause.message : "Try again."}`
          );
      });
    return () => controller.abort();
  }, [packageId, refresh]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="certification-gate" aria-label="Publication certification gate">
      <h3>Certification & publication</h3>
      <p role="status">{message}</p>
      <p>
        Reports are operator-supplied evidence. Matching checksums verify consistency, not the
        identity of the issuer. The platform remains authoritative for access and publication.
      </p>
      <label>
        Certification report
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            setReport(event.target.files?.[0] ?? null);
          }}
        />
      </label>
      <label>
        Artifact manifest
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => setArtifactManifest(event.target.files?.[0] ?? null)}
        />
      </label>
      <Button
        disabled={busy || !report || !artifactManifest}
        onClick={() =>
          void run(async () => {
            if (report!.size > 5_000_000 || artifactManifest!.size > 5_000_000)
              throw new Error("Evidence files must be smaller than 5 MB.");
            const value: unknown = JSON.parse(await report!.text());
            const { jobId } = z.object({ jobId: z.string() }).parse(value);
            const job = jobs.find((item) => item.jobId === jobId);
            if (!job) throw new Error("Report does not match a loaded render candidate.");
            const verified = await verifyAdaptiveEvidence(
              value,
              new Uint8Array(await artifactManifest!.arrayBuffer()),
              job
            );
            setEvidence((current) => [...current.filter((item) => item.jobId !== jobId), verified]);
            setMessage(`Verified evidence for ${jobId}.`);
          })
        }
      >
        Verify evidence
      </Button>
      <ul aria-label="Verified reports">
        {evidence.map((item) => (
          <li key={item.jobId}>
            {item.jobId}
            <Button
              onClick={() => setEvidence((current) => current.filter((value) => value !== item))}
            >
              Remove report {item.jobId}
            </Button>
          </li>
        ))}
      </ul>
      <label>
        Platform artifact locations
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            setLocations(null);
            if (file)
              void run(async () => {
                if (file.size > 5_000_000)
                  throw new Error("Location file must be smaller than 5 MB.");
                setLocations(JSON.parse(await file.text()));
                setMessage("Artifact locations loaded; matching is checked before publication.");
              });
          }}
        />
      </label>
      <details>
        <summary>Artifact location format</summary>
        <p>
          Use storage keys supplied by your platform operator, never signed download URLs. Each
          array entry needs artifactId, storageKey, mediaType, checksumSha256, and byteLength.
        </p>
      </details>
      <label>
        Package name
        <input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
      </label>
      <p>{gate}</p>
      <Button
        disabled={busy || !payload}
        onClick={() =>
          void run(async () => {
            if (!payload) return;
            const body = JSON.stringify(payload);
            const requestKey = `adaptive-publication:${await sha256(new TextEncoder().encode(body))}`;
            const response = AdaptivePackagePublishResponseSchema.parse(
              await platformRequest("adaptive-packages", {
                method: "POST",
                headers: { "content-type": "application/json", "idempotency-key": requestKey },
                body
              })
            );
            if (
              response.packageId !== packageId ||
              !["accepted", "alreadyPublished"].includes(response.outcome)
            )
              throw new Error(response.errorMessage ?? `Publication ${response.outcome}.`);
            setMessage(`Published immutable version ${response.version}.`);
            setRefresh((value) => value + 1);
          })
        }
      >
        Publish immutable version
      </Button>
      <h3>Immutable version history</h3>
      <Button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
        Refresh versions
      </Button>
      <p role="status">{versionMessage}</p>
      <label>
        Revocation reason{" "}
        <input value={revokeReason} maxLength={500} onChange={(event) => setRevokeReason(event.target.value)} />
      </label>
      {!versions.length && <p>No versions loaded.</p>}
      {versions.map((item) => (
        <p key={item.version}>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = AdaptivePackageVersionSchema.parse(
                  await platformRequest(
                    `adaptive-packages/${encodeURIComponent(packageId)}/versions/${item.version}`
                  )
                );
                if (result.packageId !== packageId || result.version !== item.version)
                  throw new Error("Version response does not match.");
                setVersion(result);
              })
            }
          >
            Inspect version {item.version}
          </Button>{" "}
          {item.revisionId} · {item.createdAt} · <strong>{item.retentionStatus}</strong>
          {item.expiresAt && <> · expires {item.expiresAt}</>}{" "}
          {item.retentionStatus !== "revoked" && (
            <Button
              disabled={busy || !revokeReason.trim()}
              title="Players stop receiving this version; revoking the active version restores the previous one."
              onClick={() =>
                void run(async () => {
                  const result = AdaptivePackageRevokeResponseSchema.parse(
                    await platformRequest(
                      `adaptive-packages/${encodeURIComponent(packageId)}/versions/${item.version}/revoke`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ reason: revokeReason.trim() })
                      }
                    )
                  );
                  setMessage(
                    result.restoredVersion
                      ? `Revoked version ${item.version}; players now receive version ${result.restoredVersion}.`
                      : `Revoked version ${item.version}.`
                  );
                  setRefresh((value) => value + 1);
                })
              }
            >
              Revoke version {item.version}
            </Button>
          )}
        </p>
      ))}
      {version !== null && (
        <details open>
          <summary>Immutable snapshot</summary>
          <pre tabIndex={0} aria-label="Immutable version JSON">
            {JSON.stringify(version, null, 2)}
          </pre>
        </details>
      )}
    </aside>
  );
}
