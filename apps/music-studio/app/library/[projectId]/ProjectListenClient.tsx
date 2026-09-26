"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RenderJobSchema, type RenderJob } from "@synaptix/render-contracts";
import { z } from "zod";

import { ListeningDock } from "../../../components/player/MiniPlayer";
import { ChevronLeftIcon, EditIcon, PauseIcon, PlayIcon, RepeatIcon, WaveIcon } from "../../../components/player/icons";
import { ProjectArtwork } from "../../../components/player/ProjectArtwork";
import playerStyles from "../../../components/player/player.module.css";
import { platformRequest } from "../../../lib/platform/platform-request";
import { formatClock, playbackItemKey, summarizeTracks, type PlaybackItem } from "../../../lib/player/playback-model";
import { currentItem, usePlayer } from "../../../lib/player/player-store";
import { mixItem, projectSubtitle, useLibrary } from "../../../lib/player/use-library";
import styles from "../library.module.css";

type LatestRender =
  | { state: "loading" }
  | { state: "none"; reason: string }
  | { state: "ready"; job: RenderJob; artifactId: string; fileName: string; durationSeconds: number };

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
        setLatest({ state: "ready", job, artifactId: master.artifactId, fileName: master.fileName, durationSeconds: master.durationSeconds });
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

  const renderItem: PlaybackItem | null = render.state === "ready" && entry ? {
    kind: "render", projectId, title: entry.name, subtitle: `Rendered mix · ${render.fileName}`,
    jobId: render.job.jobId, renderId: render.job.manifest.renderId, artifactId: render.artifactId
  } : null;

  return (
    <div className={styles.shell}>
      <header className={styles.hero}>
        <div className={styles.heroBackdrop} aria-hidden="true"><ProjectArtwork seed={projectId} project={project} /></div>
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroContent}>
          <div className={styles.heroNav}>
            <Link className={playerStyles.iconButton} href="/library" aria-label="Back to Library"><ChevronLeftIcon /></Link>
            <Link className={playerStyles.pill} href={`/studio/${encodeURIComponent(projectId)}`}><EditIcon size={16} /> Open in Studio</Link>
          </div>
          <ProjectArtwork className={styles.heroArt} seed={projectId} project={project} label={entry ? `${entry.name} artwork` : undefined} />
          <span className={styles.badge}><WaveIcon size={14} /> {render.state === "ready" ? "Rendered mix available" : "Live mix"}</span>
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
            <ProjectArtwork className={styles.renderArt} seed={projectId} project={project} />
            <div className={styles.renderText}>
              <small>Latest render</small>
              {render.state === "ready"
                ? <><strong>{render.fileName}</strong><span>{formatClock(render.durationSeconds)} · mastered by the render worker</span></>
                : <><strong>{render.state === "loading" ? "Checking renders…" : "Hear the live mix"}</strong>
                  <span>{render.state === "none" ? render.reason : "Looking for a finished render"}</span></>}
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
