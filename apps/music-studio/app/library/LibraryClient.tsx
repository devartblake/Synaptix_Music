"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ListeningDock } from "../../components/player/MiniPlayer";
import { PauseIcon, PlayIcon } from "../../components/player/icons";
import { ProjectArtwork } from "../../components/player/ProjectArtwork";
import playerStyles from "../../components/player/player.module.css";
import { formatClock } from "../../lib/player/playback-model";
import { currentItem, usePlayer } from "../../lib/player/player-store";
import { mixItem, projectSubtitle, useLibrary } from "../../lib/player/use-library";
import styles from "./library.module.css";

export function LibraryClient() {
  const { entries, status } = useLibrary();
  const [query, setQuery] = useState("");
  const playing = usePlayer((state) => state.status === "playing");
  const nowPlaying = usePlayer(currentItem);
  const playQueue = usePlayer((state) => state.playQueue);
  const toggle = usePlayer((state) => state.toggle);

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
        <input id="search" className={styles.search} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your projects" aria-label="Search your projects" />

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
                      <ProjectArtwork seed={entry.projectId} project={entry.project} />
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
