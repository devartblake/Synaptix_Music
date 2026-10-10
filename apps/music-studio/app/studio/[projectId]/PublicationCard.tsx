"use client";

import { useEffect, useState } from "react";

import type { AdaptivePackageSharing, AdaptivePackageVersionSummary } from "@synaptix/platform-contracts/adaptive-packages";
import { Button } from "../../../components/ui/StudioControls";
import { platformRequest } from "../../../lib/platform/platform-request";
import { isPlatformProjectId } from "@synaptix/project-storage/platform-sync";
import { loadSharing, sharingDetail } from "../../../lib/platform/community-sharing";
import { draftPackageId, findProjectPackageIds, loadPackageVersions, publicationStatus } from "../../../lib/platform/publication-status";

type Versions =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "loaded"; versions: AdaptivePackageVersionSummary[]; sharing: AdaptivePackageSharing | null }
  | { kind: "unavailable"; message: string };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * The DAW inspector's SynaptixPlay card: whether this project's adaptive music is live in games,
 * from the platform's published versions of the package being authored in Adaptive states.
 */
export function PublicationCard({ projectId, revisionId, refreshKey, onOpenAdaptive }: {
  projectId: string;
  revisionId: string;
  /** Re-checks when it changes (e.g. on leaving Adaptive states, where publishing happens). */
  refreshKey: string;
  onOpenAdaptive: () => void;
}) {
  const [versions, setVersions] = useState<Versions>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // The package this browser is authoring comes first; otherwise ask the platform for the
    // project's newest package (cloud projects only: browser-only projects can't be published).
    const draft = draftPackageId(projectId);
    if (!draft && !isPlatformProjectId(projectId)) {
      setVersions({ kind: "none" });
      return;
    }
    const controller = new AbortController();
    setVersions({ kind: "loading" });
    const packageId = draft
      ? Promise.resolve(draft)
      : findProjectPackageIds(projectId, platformRequest, controller.signal).then((ids) => ids[0] ?? null);
    packageId.then((id) => id === null ? null : Promise.all([
      loadPackageVersions(id, platformRequest, controller.signal),
      // Whether other players can use it is a detail: the card still shows if this fails.
      loadSharing(id, platformRequest, controller.signal).catch(() => null)
    ])).then(
      (loaded) => {
        if (!controller.signal.aborted)
          setVersions(loaded === null ? { kind: "none" } : { kind: "loaded", versions: loaded[0], sharing: loaded[1] });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setVersions({ kind: "unavailable", message: error instanceof Error ? error.message : "The platform didn't answer." });
      }
    );
    return () => controller.abort();
  }, [projectId, refreshKey, attempt]);

  const status = versions.kind === "loaded" ? publicationStatus(versions.versions, revisionId)
    : versions.kind === "none" ? { kind: "unpublished" as const } : null;
  const openAdaptive = <Button onClick={onOpenAdaptive}>Open Adaptive states</Button>;
  let dot = "idle";
  let headline: string;
  let detail: React.ReactNode;
  if (versions.kind === "loading") {
    headline = "Checking SynaptixPlay…";
    detail = null;
  } else if (versions.kind === "unavailable") {
    headline = "Status unavailable";
    detail = <><p>{versions.message} Sign in to SynaptixPlay to see whether this music is live.</p><Button onClick={() => setAttempt((value) => value + 1)}>Check again</Button></>;
  } else if (status?.kind === "live") {
    dot = "live";
    headline = `Live in SynaptixPlay · version ${status.version}`;
    detail = <>
      <p>Games play version {status.version}, published {day(status.publishedAt)}.</p>
      {status.finalizing && <p>Version {status.finalizing} is being finalized and replaces it when ready.</p>}
      {!status.fromCurrentRevision && <p>The project has changed since. Publish again from Adaptive states to update the games.</p>}
    </>;
  } else if (status?.kind === "finalizing") {
    dot = "warning";
    headline = `Publishing version ${status.version}`;
    detail = <p>The platform is finalizing its audio. Games get it once that&apos;s done.</p>;
  } else if (status?.kind === "not-live") {
    dot = "danger";
    headline = `Not live · version ${status.version} ${status.reason === "superseded" ? "replaced" : status.reason}`;
    detail = <><p>No version of this music is playing in games. Publish a new version from Adaptive states.</p>{openAdaptive}</>;
  } else {
    headline = "Not in SynaptixPlay yet";
    detail = <><p>Render a master mix, build adaptive states from it, then publish them to SynaptixPlay games.</p>{openAdaptive}</>;
  }

  const sharing = versions.kind === "loaded" && versions.versions.length ? versions.sharing : null;
  return (
    <section className="inspector-card publication-card" aria-labelledby="publication-card-title">
      <strong id="publication-card-title">SynaptixPlay</strong>
      <div className="adaptive-row" role="status">
        {dot === "live" ? <span className="adaptive-orb" /> : <span className={`status-dot ${dot}`} />}
        {headline}
      </div>
      {detail}
      {sharing && sharing.kind === "community" && (
        <p className="publication-sharing">
          <strong>{sharing.sharing === "shared" ? "Shared" : "Private"}</strong> · {sharingDetail(sharing)}
        </p>
      )}
    </section>
  );
}
