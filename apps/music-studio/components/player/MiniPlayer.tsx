"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { currentItem, usePlayer } from "../../lib/player/player-store";
import { HomeIcon, LibraryIcon, NextIcon, PauseIcon, PlayIcon, SearchIcon, StudioIcon } from "./icons";
import { NowPlaying } from "./NowPlaying";
import { ProjectArtwork } from "./ProjectArtwork";
import styles from "./player.module.css";

/**
 * Floating glass dock for listening pages: the mini player (when something is queued) above
 * the tab bar. The studio has its own transport, so this dock is not rendered there.
 */
export function ListeningDock({ showTabs = true }: { showTabs?: boolean }) {
  const pathname = usePathname() ?? "/";
  const item = usePlayer(currentItem);
  const status = usePlayer((state) => state.status);
  const error = usePlayer((state) => state.error);
  const position = usePlayer((state) => state.positionSeconds);
  const duration = usePlayer((state) => state.durationSeconds);
  const toggle = usePlayer((state) => state.toggle);
  const next = usePlayer((state) => state.next);
  const setExpanded = usePlayer((state) => state.setExpanded);
  const playing = status === "playing";
  const progress = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  const tab = (href: string, label: string, icon: React.ReactNode) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link className={styles.tab} href={href} aria-current={active ? "page" : undefined}>
        {icon}
        <span>{label}</span>
      </Link>
    );
  };

  return (
    <>
      <div className={styles.dock}>
        {item && (
          <section className={styles.mini} aria-label="Mini player">
            <button type="button" className={styles.miniOpen} onClick={() => setExpanded(true)}
              aria-label={`Open Now Playing: ${item.title}`}>
              <ProjectArtwork className={styles.miniArt} seed={item.projectId} />
              <span className={styles.miniText}>
                <strong>{item.title}</strong>
                <span className={status === "error" ? styles.miniError : undefined}>
                  {status === "error" ? error : status === "loading" ? "Loading…" : item.subtitle}
                </span>
              </span>
            </button>
            <div className={styles.miniControls}>
              <button type="button" onClick={() => void toggle()} aria-label={playing ? "Pause" : "Play"}
                disabled={status === "loading"}>
                {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
              </button>
              <button type="button" onClick={() => void next()} aria-label="Next">
                <NextIcon size={22} />
              </button>
            </div>
            <div className={styles.miniProgress} aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
          </section>
        )}
        {showTabs && (
          <nav className={styles.tabs} aria-label="Listening">
            <div className={styles.tabBar}>
              {tab("/", "Home", <HomeIcon />)}
              {tab("/library", "Library", <LibraryIcon />)}
              {tab("/studio/local-demo", "Studio", <StudioIcon />)}
            </div>
            <Link className={styles.searchTab} href="/library#search" aria-label="Search your library">
              <SearchIcon size={22} />
            </Link>
          </nav>
        )}
      </div>
      <NowPlaying />
    </>
  );
}
