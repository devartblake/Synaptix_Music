"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { AudioTransport } from "@synaptix/daw-engine";
import type { Clip, MusicProject, Track } from "@synaptix/project-model";
import {
  SetTrackMutedEditorCommand,
  SetLoopRegionEditorCommand,
  SetTrackSoloEditorCommand,
  type EditorCommand
} from "@synaptix/command-system/editor";
import { AddClipEditorCommand, RemoveTrackEditorCommand } from "@synaptix/command-system/track";
import { Badge, Button } from "../../../components/ui/StudioControls";
import { arrangementBars, barRange, barTicks, positionTicks } from "../../../lib/editor/timeline-model";
import { canAddMidiClip, createEmptyMidiClip } from "../../../lib/editor/new-clip";
import { Playhead } from "./TransportPosition";
import { ChannelMeters, TrackLevel } from "./ChannelMeters";
import { LoopLane, MarkerLane } from "./TimelineLanes";
import { INSTRUMENT_DRAG_TYPE } from "./StudioBrowser";
import styles from "./editing.module.css";

export function ArrangementTimeline({
  project,
  engine,
  onExecute,
  onEdit,
  renderControls,
  trackColor,
  emptyState,
  onSelect,
  onDropInstrument,
  trackAccessory
}: {
  project: MusicProject;
  engine: AudioTransport;
  onExecute(command: EditorCommand): Promise<void>;
  onEdit(clip: { trackId: string; clipId: string }): void;
  renderControls(track: Track): ReactNode;
  /** The DAW layout (Studio UI v2): each track and its clips take this colour, and headers get a level meter. */
  trackColor?: (track: Track) => string;
  /** The DAW layout: shown in place of the lanes when there are no tracks. */
  emptyState?: ReactNode;
  /** The DAW layout: told when the selected clip changes (the inspector follows it). */
  onSelect?: (clip: { trackId: string; clipId: string } | null) => void;
  /** The DAW layout: an instrument dragged from the Browser was dropped on a track (swap) or elsewhere (add). */
  onDropInstrument?: (deviceType: string, trackId: string | null) => void;
  /** The DAW layout: extra content on a track's header, after its name (e.g. its sticky notes). */
  trackAccessory?: (track: Track) => ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const select = (clip: { trackId: string; clipId: string } | null) => {
    setSelected(clip?.clipId ?? null);
    onSelect?.(clip);
  };
  const bars = arrangementBars(project);
  const duration = bars * barTicks(project);
  const daw = Boolean(trackColor);
  const timeline = (
    <section aria-label="Arrangement timeline" className="canvas-panel" data-variant={daw ? "daw" : undefined}
      onDragOver={onDropInstrument ? (event) => { if (event.dataTransfer.types.includes(INSTRUMENT_DRAG_TYPE)) event.preventDefault(); } : undefined}
      onDrop={onDropInstrument ? (event) => {
        const deviceType = event.dataTransfer.getData(INSTRUMENT_DRAG_TYPE);
        if (!deviceType) return;
        event.preventDefault();
        const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-track-id]") : null;
        onDropInstrument(deviceType, row?.dataset.trackId ?? null);
      } : undefined}
      onKeyDown={daw ? (event) => {
        // L loops the selected clip (whole bars it covers), as one undo step.
        if (event.key.toLowerCase() !== "l" || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        const clip = project.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === selected);
        if (!clip) return;
        event.preventDefault();
        const first = clip.range.start.bar;
        const last = Math.ceil((positionTicks(project, clip.range.start) + clip.range.durationTicks) / barTicks(project)) - 1;
        void onExecute(new SetLoopRegionEditorCommand(
          { enabled: project.transport.loopEnabled, range: project.transport.loopRange },
          { enabled: true, range: barRange(project, first, Math.max(first, last)) }
        ));
      } : undefined}>
      <div
        className={styles.arrangement}
        style={{ "--bars": bars, minWidth: 240 + bars * 52 } as CSSProperties}
      >
        {daw && <>
          <MarkerLane project={project} engine={engine} bars={bars} duration={duration} onExecute={onExecute} />
          <LoopLane project={project} engine={engine} bars={bars} duration={duration} onExecute={onExecute} />
        </>}
        <div className={styles.rulerRow}>
          <div className={styles.trackTitle}>
            TRACKS <Badge>{project.tracks.length}</Badge>
          </div>
          <div className={styles.ruler} aria-label="Seek by bar">
            {Array.from({ length: bars }, (_, bar) => (
              <Button
                key={bar}
                aria-label={`Seek to bar ${bar + 1}`}
                onClick={() => engine.seek({ bar, beat: 0, tick: 0 })}
              >
                {bar + 1}
              </Button>
            ))}
          </div>
        </div>
        <div className={styles.lanes}>
          {!(daw && project.tracks.length === 0) && <div className={styles.arrangementPlayhead}>
            <Playhead engine={engine} project={project} duration={duration} />
          </div>}
          {daw && project.tracks.length === 0 && emptyState}
          {project.tracks.map((track, index) => (
            <div key={track.id} className={styles.trackRow} data-muted={daw && track.muted ? true : undefined}
              data-track-id={onDropInstrument ? track.id : undefined}
              style={trackColor ? { "--track-color": trackColor(track) } as CSSProperties : undefined}>
              <div className={styles.trackHeader}>
                {daw && <TrackLevel id={`track:${track.id}`} name={track.name} />}
                <div className={styles.trackName}>
                  <span className="track-index">{index + 1}</span>
                  <strong>{track.name}</strong>
                  {trackAccessory?.(track)}
                </div>
                <div className={styles.trackActions}>
                  <Button
                    aria-label={`Mute ${track.name}`}
                    aria-pressed={track.muted}
                    onClick={() =>
                      void onExecute(
                        new SetTrackMutedEditorCommand(track.id, track.muted, !track.muted)
                      )
                    }
                  >
                    M
                  </Button>
                  <Button
                    aria-label={`Solo ${track.name}`}
                    aria-pressed={track.solo}
                    onClick={() =>
                      void onExecute(
                        new SetTrackSoloEditorCommand(track.id, track.solo, !track.solo)
                      )
                    }
                  >
                    S
                  </Button>
                  <small>
                    {track.volumeDb} dB ·{" "}
                    {track.pan === 0
                      ? "Center"
                      : `${Math.round(Math.abs(track.pan) * 100)}${track.pan < 0 ? "L" : "R"}`}
                  </small>
                  {canAddMidiClip(track) && (
                    <Button
                      className={styles.newClip}
                      aria-label={`New clip on ${track.name}`}
                      title="Add an empty 4-bar clip after the last one and open it"
                      onClick={() => {
                        const clip = createEmptyMidiClip(project, track);
                        void onExecute(new AddClipEditorCommand(track.id, clip)).then(() =>
                          onEdit({ trackId: track.id, clipId: clip.id })
                        );
                      }}
                    >
                      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"
                        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M8 3v10M3 8h10" />
                      </svg>
                    </Button>
                  )}
                  <Button
                    className={styles.deleteTrack}
                    aria-label={`Delete ${track.name}`}
                    title={`Delete ${track.name} (undo restores it)`}
                    onClick={() => void onExecute(new RemoveTrackEditorCommand(track.id))}
                  >
                    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"
                      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5" />
                    </svg>
                  </Button>
                </div>
                <details className={styles.trackControls}>
                  <summary>{track.name} controls</summary>
                  {renderControls(track)}
                </details>
              </div>
              <div className={styles.trackLane}>
                {track.clips.map((clip) => (
                  <div
                    key={clip.id}
                    className={styles.clip}
                    data-selected={selected === clip.id}
                    style={{
                      left: `${(positionTicks(project, clip.range.start) / duration) * 100}%`,
                      width: `${(clip.range.durationTicks / duration) * 100}%`
                    }}
                  >
                    <button
                      className={styles.clipSelect}
                      aria-label={`Select ${clip.name}`}
                      aria-pressed={selected === clip.id}
                      onClick={() => select({ trackId: track.id, clipId: clip.id })}
                      onDoubleClick={() =>
                        clip.kind === "midi" && onEdit({ trackId: track.id, clipId: clip.id })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && clip.kind === "midi") {
                          event.preventDefault();
                          onEdit({ trackId: track.id, clipId: clip.id });
                        }
                        if (event.key === "Escape") select(null);
                      }}
                    >
                      <strong>{clip.name}</strong>
                      <small>
                        {clip.kind === "midi" ? `${clip.notes.length} notes` : "Audio clip"}
                        {clip.loop ? " · Loop" : ""}
                      </small>
                      <ClipPreview clip={clip} />
                    </button>
                    {clip.kind === "midi" && (
                      <Button
                        className={styles.clipEdit}
                        onClick={() => {
                          select({ trackId: track.id, clipId: clip.id });
                          onEdit({ trackId: track.id, clipId: clip.id });
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className={styles.hint}>
        Select a clip · Enter or double-click to edit · Select a bar number to seek{daw ? " · L loops the selected clip" : ""}
      </p>
    </section>
  );
  return daw ? <ChannelMeters engine={engine}>{timeline}</ChannelMeters> : timeline;
}

function ClipPreview({ clip }: { clip: Clip }) {
  if (clip.kind !== "midi" || !clip.notes.length) return null;
  const low = Math.min(...clip.notes.map((note) => note.pitch));
  const high = Math.max(low + 12, ...clip.notes.map((note) => note.pitch));
  return (
    <svg
      className={styles.clipPreview}
      viewBox="0 0 1000 40"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {clip.notes.map((note) => (
        <rect
          key={note.id}
          x={(note.startTick / clip.range.durationTicks) * 1000}
          y={((high - note.pitch) / (high - low)) * 34}
          width={Math.max(2, (note.durationTicks / clip.range.durationTicks) * 1000)}
          height={3}
          rx={1}
          fill="currentColor"
          opacity={0.45 + note.velocity / 254}
        />
      ))}
    </svg>
  );
}
