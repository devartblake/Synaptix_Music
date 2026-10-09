"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { formatClock, playbackItemKey, studioHref } from "../../lib/player/playback-model";
import { currentItem, usePlayer } from "../../lib/player/player-store";
import { ChevronDownIcon, EditIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, RepeatIcon } from "./icons";
import { CoverArt } from "./CoverArt";
import styles from "./player.module.css";

/** Full-screen Now Playing sheet (modal dialog), opened from the mini player. */
export function NowPlaying() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const state = usePlayer();
  const item = currentItem(state);
  const [scrub, setScrub] = useState<number | null>(null);
  const playing = state.status === "playing";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (state.expanded && item && !dialog.open) dialog.showModal();
    if ((!state.expanded || !item) && dialog.open) dialog.close();
  }, [state.expanded, item]);

  const position = scrub ?? state.positionSeconds;
  const duration = state.durationSeconds;

  return (
    <dialog ref={dialogRef} className={styles.sheet} aria-label="Now playing"
      onClose={() => state.setExpanded(false)}>
      {item && <>
        <div className={styles.sheetBackdrop} aria-hidden="true"><CoverArt projectId={item.projectId} /></div>
        <div className={styles.sheetShade} aria-hidden="true" />
        <div className={styles.sheetContent}>
          <div className={styles.sheetTop}>
            <button type="button" className={styles.iconButton} onClick={() => state.setExpanded(false)} aria-label="Close Now Playing">
              <ChevronDownIcon />
            </button>
            <span>{item.kind === "render" ? "Rendered mix" : item.soloTrackId ? "Track preview" : "Live mix"}</span>
            {/* Editing continues from the listening position. */}
            <Link className={styles.iconButton} href={studioHref(item.projectId, position)} aria-label="Open in Studio">
              <EditIcon />
            </Link>
          </div>

          <CoverArt className={styles.sheetArt} projectId={item.projectId} label={`${item.title} artwork`} />

          <div className={styles.sheetTitle}>
            <h2>{item.title}</h2>
            <p>{state.status === "error" ? state.error : item.subtitle}</p>
          </div>

          <div className={styles.scrub}>
            <input type="range" aria-label="Playback position" min={0} max={Math.max(duration, 0.1)} step={0.1}
              value={Math.min(position, duration || position)} disabled={!duration}
              aria-valuetext={`${formatClock(position)} of ${formatClock(duration)}`}
              onChange={(event) => setScrub(Number(event.target.value))}
              onPointerUp={(event) => { state.seek(Number(event.currentTarget.value)); setScrub(null); }}
              onKeyUp={(event) => { state.seek(Number(event.currentTarget.value)); setScrub(null); }} />
            <div className={styles.scrubTimes} aria-hidden="true">
              <span>{formatClock(position)}</span>
              <span>-{formatClock(Math.max(0, duration - position))}</span>
            </div>
          </div>

          <div className={styles.transport}>
            <button type="button" className={state.repeat === "one" ? styles.repeatOne : undefined}
              aria-pressed={state.repeat !== "off"} onClick={state.cycleRepeat}
              aria-label={`Repeat: ${state.repeat === "off" ? "off" : state.repeat === "all" ? "all" : "one"}`}>
              <RepeatIcon size={22} />
            </button>
            <button type="button" onClick={() => void state.previous()} aria-label="Previous"><PreviousIcon size={30} /></button>
            <button type="button" className={styles.playButton} onClick={() => void state.toggle()}
              disabled={state.status === "loading"} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <PauseIcon size={30} /> : <PlayIcon size={30} />}
            </button>
            <button type="button" onClick={() => void state.next()} aria-label="Next"><NextIcon size={30} /></button>
            <span style={{ width: 52 }} aria-hidden="true" />
          </div>

          {state.queue.length > 1 && (
            <section className={styles.queue} aria-label="Up next">
              <h3>Up next</h3>
              {state.queue.map((queued, index) => (
                <button type="button" key={`${playbackItemKey(queued)}-${index}`} className={styles.row}
                  aria-current={index === state.index ? "true" : undefined}
                  onClick={() => void state.playQueue(state.queue, index)}>
                  <span className={styles.rowIndex}>{index + 1}</span>
                  <CoverArt className={styles.rowArt} projectId={queued.projectId} />
                  <span className={styles.rowText}><strong>{queued.title}</strong><span>{queued.subtitle}</span></span>
                  <span />
                </button>
              ))}
            </section>
          )}
        </div>
      </>}
    </dialog>
  );
}
