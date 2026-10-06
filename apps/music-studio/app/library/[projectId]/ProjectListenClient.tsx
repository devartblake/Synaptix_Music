"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { RenderJobSchema, type RenderArtifact, type RenderJob } from "@synaptix/render-contracts";
import { z } from "zod";

import { ListeningDock } from "../../../components/player/MiniPlayer";
import { ChevronLeftIcon, EditIcon, PauseIcon, PlayIcon, RepeatIcon, WaveIcon } from "../../../components/player/icons";
import { ActionsMenu } from "../../../components/player/ActionsMenu";
import { CoverArt } from "../../../components/player/CoverArt";
import { ProjectArtwork } from "../../../components/player/ProjectArtwork";
import playerStyles from "../../../components/player/player.module.css";
import { platformRequest } from "../../../lib/platform/platform-request";
import { formatClock, playbackItemKey, summarizeTracks, type PlaybackItem } from "../../../lib/player/playback-model";
import { removeProjectCover, setProjectCover, useCoverUrl } from "../../../lib/player/covers";
import { formatBytes, useOfflineRenders } from "../../../lib/player/offline-renders";
import { currentItem, usePlayer } from "../../../lib/player/player-store";
import { useOnline } from "../../../lib/pwa/use-online";
import { mixItem, projectSubtitle, useLibrary } from "../../../lib/player/use-library";
import styles from "../library.module.css";

type LatestRender =
  | { state: "loading" }
  | { state: "none"; reason: string }
  | { state: "ready"; job: RenderJob; artifact: RenderArtifact };

/** Newest completed render of this project, preferring its short preview file for listening. */
function useLatestRender(projectId: string): LatestRender {
  const [latest, setLatest] = useState<LatestRender>({ state: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    platformRequest("render-jobs", { signal: controller.signal })
      .then((body) => {
        const jobs = z.object({ jobs: z.array(RenderJobSchema) }).parse(body).jobs
          .filter((job) => job.manifest.projectId === projectId && job.status === "completed" && job.result?.artifacts.length)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const job = jobs[0];
        if (!job?.result) return setLatest({ state: "none", reason: "No rendered mix yet." });
        const master = job.result.artifacts.find((artifact) => artifact.trackId === null) ?? job.result.artifacts[0]!;
        setLatest({ state: "ready", job, artifact: master });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLatest({ state: "none", reason: "Sign in to the platform to hear rendered mixes." });
      });
    return () => controller.abort();
  }, [projectId]);
  return latest;
}

export function ProjectListenClient({ projectId }: { projectId: string }) {
  const { entries, status } = useLibrary();
  const entry = entries.find((candidate) => candidate.projectId === projectId);
  const project = entry?.project ?? null;
  const render = useLatestRender(projectId);
  const player = usePlayer();
  const nowPlaying = currentItem(player);
  const playing = player.status === "playing";
  const coverUrl = useCoverUrl(projectId);
  const online = useOnline();
  const coverInput = useRef<HTMLInputElement>(null);
  const [coverMessage, setCoverMessage] = useState<string | null>(null);

  async function changeCover(file: File | undefined) {
    if (!file) return;
    setCoverMessage("Saving cover…");
    try {
      await setProjectCover(projectId, file);
      setCoverMessage("Cover updated.");
    } catch (cause) {
      setCoverMessage(cause instanceof Error ? cause.message : "Couldn't save this cover.");
    } finally {
      if (coverInput.current) coverInput.current.value = "";
    }
  }

  const tracks = useMemo(() => (project ? summarizeTracks(project) : []), [project]);
  const mix = entry && project ? mixItem(entry) : null;
  const trackItems: PlaybackItem[] = useMemo(() => project && entry ? tracks.map((track) => ({
    kind: "project" as const, projectId, title: track.name, subtitle: `${entry.name} · ${track.instrument}`, soloTrackId: track.trackId
  })) : [], [project, entry, tracks, projectId]);

  const isCurrent = (item: PlaybackItem | null) => Boolean(item && nowPlaying && playbackItemKey(item) === playbackItemKey(nowPlaying));

  function playItem(item: PlaybackItem, queue: PlaybackItem[] = [item]) {
    if (isCurrent(item)) return void player.toggle();
    void player.playQueue(queue, Math.max(0, queue.findIndex((candidate) => playbackItemKey(candidate) === playbackItemKey(item))));
  }

  const offline = useOfflineRenders();
  useEffect(() => { void useOfflineRenders.getState().refresh(); }, []);
  // The platform's newest render when reachable; otherwise the newest copy downloaded here.
  const downloadedHere = offline.renders.find((cached) => cached.projectId === projectId);
  const shown = render.state === "ready"
    ? { jobId: render.job.jobId, renderId: render.job.manifest.renderId, artifactId: render.artifact.artifactId,
      fileName: render.artifact.fileName, durationSeconds: render.artifact.durationSeconds, byteLength: render.artifact.byteLength }
    : downloadedHere ?? null;
  const cached = shown ? offline.renders.find((candidate) => candidate.artifactId === shown.artifactId) : undefined;
  const pending = shown ? offline.pending[shown.artifactId] : undefined;
  const renderItem: PlaybackItem | null = shown && entry ? {
    kind: "render", projectId, title: entry.name, subtitle: `Rendered mix · ${shown.fileName}`,
    jobId: shown.jobId, renderId: shown.renderId, artifactId: shown.artifactId
  } : null;

  return (
    <div className={styles.shell}>
      <header className={styles.hero}>
        <div className={styles.heroBackdrop} aria-hidden="true"><CoverArt projectId={projectId} project={project} /></div>
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroContent}>
          <div className={styles.heroNav}>
            <Link className={playerStyles.iconButton} href="/library" aria-label="Back to Library"><ChevronLeftIcon /></Link>
            {entry && (
              <ActionsMenu label="Project options" items={[
                { kind: "action", label: coverUrl ? "Change cover" : "Add cover", onSelect: () => coverInput.current?.click() },
                ...(coverUrl ? [{ kind: "action" as const, label: "Remove cover", destructive: true,
                  onSelect: () => void removeProjectCover(projectId).then(() => setCoverMessage("Cover removed.")) }] : []),
                { kind: "link", label: "Rename", href: `/studio/${encodeURIComponent(projectId)}?rename=1` }
              ]} />
            )}
          </div>
          <CoverArt className={styles.heroArt} projectId={projectId} project={project} label={entry ? `${entry.name} artwork` : undefined} />
          <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-hidden="true" tabIndex={-1}
            onChange={(event) => void changeCover(event.target.files?.[0])} />
          {coverMessage && <p className={styles.status} role="status">{coverMessage}</p>}
          <span className={styles.badge}><WaveIcon size={14} /> {shown ? (cached ? "Rendered mix · offline" : "Rendered mix available") : "Live mix"}</span>
          <h1 className={styles.heroTitle}>{entry?.name ?? (status === "loading" ? "Loading…" : "Project not found")}</h1>
          {entry && <p className={styles.heroMeta}>{projectSubtitle(project)} · {formatClock(entry.durationSeconds)}</p>}
          {mix && (
            <div className={styles.heroActions}>
              <Link className={playerStyles.iconButton} href={`/studio/${encodeURIComponent(projectId)}`} aria-label="Edit in Studio"><EditIcon /></Link>
              <button type="button" className={playerStyles.playButton} onClick={() => playItem(mix, [mix, ...trackItems])}
                aria-label={isCurrent(mix) && playing ? "Pause mix" : "Play mix"}>
                {isCurrent(mix) && playing ? <PauseIcon size={30} /> : <PlayIcon size={30} />}
              </button>
              <button type="button" className={playerStyles.iconButton} onClick={player.cycleRepeat}
                aria-pressed={player.repeat !== "off"} aria-label={`Repeat: ${player.repeat}`}><RepeatIcon /></button>
            </div>
          )}
        </div>
      </header>

      <main className={styles.body} id="main">
        {status === "ready" && !entry && (
          <div className={styles.empty}>
            <span>This project isn't saved in this browser.</span>
            <Link className={playerStyles.pill} href="/library">Back to Library</Link>
          </div>
        )}

        {entry && (
          <section className={styles.renderCard} aria-label="Latest render">
            <CoverArt className={styles.renderArt} projectId={projectId} project={project} />
            <div className={styles.renderText}>
              <small>Latest render</small>
              {shown
                ? <><strong>{shown.fileName}</strong>
                  <span>
                    {formatClock(shown.durationSeconds)} · {cached ? `Downloaded · ${formatBytes(cached.byteLength)}` : "Streams from the cloud"}
                  </span></>
                : <><strong>{render.state === "loading" ? "Checking renders…" : "Hear the live mix"}</strong>
                  <span>{render.state === "none" ? render.reason : "Looking for a finished render"}</span></>}
              {shown && (
                <span className={styles.offlineActions}>
                  {cached
                    ? <button type="button" className={styles.linkButton} onClick={() => void offline.remove(shown.artifactId)}>
                      Remove download
                    </button>
                    : render.state === "ready" && (
                      <button type="button" className={styles.linkButton} disabled={pending === "downloading" || !online}
                        title={online ? undefined : "Connect to download this mix"}
                        onClick={() => void offline.download(render.job, render.artifact)}>
                        {pending === "downloading" ? "Downloading…" : "Download for offline"}
                      </button>
                    )}
                  {pending && pending !== "downloading" && <span role="alert" className={styles.offlineError}>{pending}</span>}
                </span>
              )}
            </div>
            {renderItem
              ? <button type="button" className={playerStyles.iconButton} onClick={() => playItem(renderItem)}
                aria-label={isCurrent(renderItem) && playing ? "Pause render" : "Play render"}>
                {isCurrent(renderItem) && playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              : <Link className={playerStyles.iconButton} href={`/studio/${encodeURIComponent(projectId)}`} aria-label="Render in Studio"><WaveIcon /></Link>}
          </section>
        )}

        {tracks.length > 0 && (
          <section aria-labelledby="tracks-heading">
            <div className={styles.sectionHead}><h2 id="tracks-heading">Tracks</h2><span>Tap a track to hear it solo</span></div>
            <div className={styles.trackList} style={{ marginTop: 8 }}>
              {tracks.map((track, index) => {
                const item = trackItems[index]!;
                const active = isCurrent(item);
                return (
                  <button key={track.trackId} type="button" className={playerStyles.row} aria-current={active ? "true" : undefined}
                    onClick={() => playItem(item, trackItems)} aria-label={`${active && playing ? "Pause" : "Play"} ${track.name} solo`}>
                    <span className={playerStyles.rowIndex}>{active && playing ? <PauseIcon size={14} /> : index + 1}</span>
                    <ProjectArtwork className={playerStyles.rowArt} seed={`${projectId}:${track.trackId}`} />
                    <span className={playerStyles.rowText}>
                      <strong>{track.name}</strong>
                      <span>
                        {track.instrument} · {track.noteCount} {track.noteCount === 1 ? "note" : "notes"}
                        {track.pluginCount > 0 ? ` · ${track.pluginCount} plug-in${track.pluginCount === 1 ? "" : "s"}` : ""}
                      </span>
                    </span>
                    <span className={playerStyles.rowMeta}>{track.kind === "instrument" ? "" : track.kind}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </main>
      <ListeningDock />
    </div>
  );
}
