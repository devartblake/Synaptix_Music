"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ListeningDock } from "../../components/player/MiniPlayer";
import { PauseIcon, PlayIcon } from "../../components/player/icons";
import { CoverArt } from "../../components/player/CoverArt";
import playerStyles from "../../components/player/player.module.css";
import { formatClock } from "../../lib/player/playback-model";
import { formatBytes, useOfflineRenders } from "../../lib/player/offline-renders";
import { playbackItemKey, type PlaybackItem } from "../../lib/player/playback-model";
import { currentItem, usePlayer } from "../../lib/player/player-store";
import { mixItem, projectSubtitle, useLibrary } from "../../lib/player/use-library";
import { useOnline } from "../../lib/pwa/use-online";
import styles from "./library.module.css";

export function LibraryClient() {
  const { entries, status } = useLibrary();
  const [query, setQuery] = useState("");
  const playing = usePlayer((state) => state.status === "playing");
  const nowPlaying = usePlayer(currentItem);
  const playQueue = usePlayer((state) => state.playQueue);
  const toggle = usePlayer((state) => state.toggle);
  const online = useOnline();
  const offline = useOfflineRenders();
  useEffect(() => { void useOfflineRenders.getState().refresh(); }, []);
  const names = useMemo(() => new Map(entries.map((entry) => [entry.projectId, entry.name])), [entries]);
  const downloads: PlaybackItem[] = offline.renders.map((render) => ({
    kind: "render", projectId: render.projectId, title: names.get(render.projectId) ?? render.fileName,
    subtitle: `Rendered mix · ${formatBytes(render.byteLength)}`, jobId: render.jobId, renderId: render.renderId, artifactId: render.artifactId
  }));
  const downloadedBytes = offline.renders.reduce((sum, render) => sum + render.byteLength, 0);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? entries.filter((entry) => entry.name.toLowerCase().includes(needle)) : entries;
  }, [entries, query]);
  const playable = visible.filter((entry) => entry.project);

  function play(projectId: string) {
    if (nowPlaying?.kind === "project" && nowPlaying.projectId === projectId && !nowPlaying.soloTrackId) {
      void toggle();
      return;
    }
    const queue = playable.map(mixItem);
    void playQueue(queue, Math.max(0, queue.findIndex((item) => item.projectId === projectId)));
  }

  return (
    <div className={styles.shell}>
      <main className={styles.page} id="main">
        <div className={styles.topbar}>
          <Link className={styles.brand} href="/"><span className="studio-mark" aria-hidden="true">S</span>Synaptix Music</Link>
          {playable.length > 0 && (
            <button type="button" className={playerStyles.pill} onClick={() => void playQueue(playable.map(mixItem), 0)}>
              <PlayIcon size={16} /> Play all
            </button>
          )}
        </div>
        <h1 className={styles.largeTitle}>Library</h1>
        {!online && (
          <p className={styles.offlineBanner} role="status">
            You're offline. Your saved projects and downloaded mixes still play; rendered mixes that aren't downloaded need a connection.
          </p>
        )}
        <input id="search" className={styles.search} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your projects" aria-label="Search your projects" />

        {downloads.length > 0 && (
          <section aria-labelledby="library-downloads">
            <div className={styles.sectionHead}>
              <h2 id="library-downloads">Downloaded</h2>
              <span>{downloads.length} {downloads.length === 1 ? "mix" : "mixes"} · {formatBytes(downloadedBytes)} · plays offline</span>
            </div>
            <div style={{ marginTop: 8 }}>
              {downloads.map((item, index) => {
                const active = nowPlaying !== undefined && playbackItemKey(nowPlaying) === playbackItemKey(item);
                return (
                  <div key={playbackItemKey(item)} className={styles.downloadRow}>
                    <button type="button" className={playerStyles.row} aria-current={active ? "true" : undefined}
                      onClick={() => (active ? void toggle() : void playQueue(downloads, index))}
                      aria-label={`${active && playing ? "Pause" : "Play"} ${item.title} (downloaded)`}>
                      <span className={playerStyles.rowIndex}>{active && playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}</span>
                      <CoverArt className={playerStyles.rowArt} projectId={item.projectId} />
                      <span className={playerStyles.rowText}><strong>{item.title}</strong><span>{item.subtitle}</span></span>
                      <span />
                    </button>
                    <button type="button" className={styles.linkButton}
                      onClick={() => item.kind === "render" && void offline.remove(item.artifactId)}
                      aria-label={`Remove download of ${item.title}`}>Remove</button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section aria-labelledby="library-projects">
          <div className={styles.sectionHead}>
            <h2 id="library-projects">Your music</h2>
            <span>{status === "ready" ? `${visible.length} ${visible.length === 1 ? "project" : "projects"} in this browser` : ""}</span>
          </div>
          {status === "loading" && <p className={styles.status} role="status">Loading your library…</p>}
          {status === "error" && <p className={styles.status} role="alert">Browser storage is unavailable, so your library can't be shown.</p>}
          {status === "ready" && visible.length === 0 && (
            <div className={styles.empty}>
              <span>{query ? "No projects match your search." : "Nothing here yet. Projects you make in the studio show up here to listen to."}</span>
              {!query && <Link className={playerStyles.pill} href="/studio/local-demo">Open the demo studio</Link>}
            </div>
          )}
          <div className={styles.grid} style={{ marginTop: 14 }}>
            {visible.map((entry) => {
              const active = nowPlaying?.kind === "project" && nowPlaying.projectId === entry.projectId && !nowPlaying.soloTrackId;
              return (
                <article key={entry.projectId} className={styles.card}>
                  <div className={styles.cardArt}>
                    <Link href={`/library/${encodeURIComponent(entry.projectId)}`} aria-label={`Open ${entry.name}`}>
                      <CoverArt projectId={entry.projectId} project={entry.project} />
                    </Link>
                    {entry.project && (
                      <button type="button" className={`${playerStyles.playButton} ${styles.cardPlay}`}
                        aria-pressed={active && playing} aria-label={active && playing ? `Pause ${entry.name}` : `Play ${entry.name}`}
                        onClick={() => play(entry.projectId)}>
                        {active && playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
                      </button>
                    )}
                  </div>
                  <Link className={styles.cardTitle} href={`/library/${encodeURIComponent(entry.projectId)}`}>{entry.name}</Link>
                  <span className={styles.cardMeta}>{projectSubtitle(entry.project)} · {formatClock(entry.durationSeconds)}</span>
                </article>
              );
            })}
          </div>
        </section>
      </main>
      <ListeningDock />
    </div>
  );
}
