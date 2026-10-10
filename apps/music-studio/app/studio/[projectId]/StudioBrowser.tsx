"use client";

import { useState } from "react";
import { INSTRUMENT_CATALOG, createInstrumentTrack, instrumentDefinition } from "@synaptix/daw-engine";
import type { InstrumentProfileKind } from "@synaptix/daw-engine";
import type { MusicProject, Track } from "@synaptix/project-model";

import { Button, ViewTabs } from "../../../components/ui/StudioControls";
import { canAddMidiClip, createEmptyMidiClip, NEW_CLIP_BARS } from "../../../lib/editor/new-clip";
import { barTicks } from "../../../lib/editor/timeline-model";
import { InstrumentIcon, INSTRUMENT_ACCENTS } from "./InstrumentIcon";

// The DAW layout's Browser (Studio UI v2, step 7): instruments to search, add, swap or drag onto
// the timeline; starter phrases; and the project's clips.

/** The drag payload for an instrument dropped on the timeline. */
export const INSTRUMENT_DRAG_TYPE = "application/x-synaptix-instrument";

const FAMILIES: Record<InstrumentProfileKind, string> = {
  drums: "Drums", "sub-bass": "Bass", bass: "Bass", lead: "Leads", pad: "Pads", pluck: "Plucks", keys: "Keys",
  organ: "Organ", strings: "Strings", brass: "Brass", bell: "Bells and mallets", poly: "Poly synths", fx: "FX"
};
type Tab = "instruments" | "patterns" | "project";
type Entry = (typeof INSTRUMENT_CATALOG)[number];

/** Catalog entries matching a search (label, description or family), grouped by family in catalog order. */
export function instrumentFamilies(query: string): { family: string; entries: Entry[] }[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map<string, Entry[]>();
  for (const entry of INSTRUMENT_CATALOG) {
    const family = FAMILIES[entry.profile.kind];
    const text = `${entry.label} ${entry.description} ${family}`.toLowerCase();
    if (!terms.every((term) => text.includes(term))) continue;
    groups.set(family, [...(groups.get(family) ?? []), entry]);
  }
  return [...groups].map(([family, entries]) => ({ family, entries }));
}

export function StudioBrowser({ project, value, onChange, selectedTrack, disabled, onAdd, onSwap, onAddClip, onOpenClip, onOpenGenerator, onExport }: {
  project: MusicProject;
  /** The chosen instrument (device type). */
  value: string;
  onChange: (deviceType: string) => void;
  /** The selected clip's track: the target for Swap and starter phrases. */
  selectedTrack: Track | null;
  disabled: boolean;
  onAdd: (deviceType: string) => void;
  onSwap: (trackId: string, deviceType: string) => void;
  onAddClip: (trackId: string, clip: ReturnType<typeof createEmptyMidiClip>) => void;
  onOpenClip: (clip: { trackId: string; clipId: string }) => void;
  onOpenGenerator: () => void;
  onExport: () => void;
}) {
  const [tab, setTab] = useState<Tab>("instruments");
  const [query, setQuery] = useState("");
  const chosen = instrumentDefinition(value) ?? INSTRUMENT_CATALOG[0]!;
  const families = instrumentFamilies(query);
  const swapTarget = selectedTrack && selectedTrack.kind === "instrument" ? selectedTrack : null;
  const phraseTarget = selectedTrack && canAddMidiClip(selectedTrack) ? selectedTrack : null;

  const starterClip = (track: Track) => {
    const clip = createEmptyMidiClip(project, track);
    const starter = createInstrumentTrack(chosen.deviceType, {
      id: clip.id, bars: NEW_CLIP_BARS,
      beatsPerBar: project.timeSignatureMap[0]?.numerator ?? 4,
      ticksPerQuarterNote: project.transport.ticksPerQuarterNote
    }).clips[0]!;
    return { ...clip, name: starter.name, loop: true, notes: starter.kind === "midi" ? starter.notes : [] };
  };
  const phraseNotes = chosen.starterPattern.length;

  return (
    <div className="studio-browser-panel">
      <ViewTabs label="Browser sections" value={tab} onChange={(next) => setTab(next as Tab)} tabs={[
        { value: "instruments", label: "Instruments", panelId: "browser-instruments" },
        { value: "patterns", label: "Patterns", panelId: "browser-patterns" },
        { value: "project", label: "Project", panelId: "browser-project" }
      ]} />

      {tab === "instruments" && (
        <div id="browser-instruments" role="tabpanel" aria-labelledby="browser-instruments-tab" className="browser-section">
          <input type="search" className="browser-search" aria-label="Search instruments" placeholder="Search instruments"
            value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <p className="browser-help" id="browser-keys">Enter adds a track{swapTarget ? `; Shift+Enter swaps ${swapTarget.name}` : ""}. Or drag onto the timeline.</p>
          {families.length === 0 && <p className="browser-help" role="status">No instruments match “{query}”.</p>}
          {families.map(({ family, entries }) => (
            <section key={family} className="browser-family" aria-label={family}>
              <h3>{family}</h3>
              <ul>
                {entries.map((entry) => (
                  <li key={entry.deviceType}>
                    <button type="button" className="browser-item" draggable={!disabled} aria-pressed={entry.deviceType === value}
                      aria-describedby="browser-keys" title={entry.description}
                      style={{ "--instrument-accent": INSTRUMENT_ACCENTS[entry.profile.kind] } as React.CSSProperties}
                      onClick={() => onChange(entry.deviceType)}
                      onDoubleClick={() => { if (!disabled) onAdd(entry.deviceType); }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || disabled) return;
                        event.preventDefault();
                        onChange(entry.deviceType);
                        if (event.shiftKey) { if (swapTarget) onSwap(swapTarget.id, entry.deviceType); }
                        else onAdd(entry.deviceType);
                      }}
                      onDragStart={(event) => {
                        onChange(entry.deviceType);
                        event.dataTransfer.setData(INSTRUMENT_DRAG_TYPE, entry.deviceType);
                        event.dataTransfer.effectAllowed = "copy";
                      }}>
                      <InstrumentIcon kind={entry.profile.kind} deviceType={entry.deviceType} size={20} />
                      <span>{entry.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="browser-actions">
            <p>{chosen.description}</p>
            <Button disabled={disabled} onClick={() => onAdd(chosen.deviceType)}>Add {chosen.label} track</Button>
            <Button disabled={disabled || !swapTarget} onClick={() => swapTarget && onSwap(swapTarget.id, chosen.deviceType)}>
              {swapTarget ? `Swap ${swapTarget.name} to ${chosen.label}` : "Select a clip to swap its track"}
            </Button>
          </div>
        </div>
      )}

      {tab === "patterns" && (
        <div id="browser-patterns" role="tabpanel" aria-labelledby="browser-patterns-tab" className="browser-section">
          <section className="browser-family" aria-label="Starter phrases">
            <h3>Starter phrases</h3>
            <p className="browser-help">{chosen.label} starter: a one-bar phrase of {phraseNotes} notes, looped for {NEW_CLIP_BARS} bars. Choose the instrument in Instruments.</p>
            <Button disabled={disabled || !phraseTarget} onClick={() => phraseTarget && onAddClip(phraseTarget.id, starterClip(phraseTarget))}>
              {phraseTarget ? `Add to ${phraseTarget.name}` : "Select a clip to add it to that track"}
            </Button>
          </section>
          <section className="browser-family" aria-label="Generator output">
            <h3>Generator output</h3>
            <p className="browser-help">Generate an arrangement, then apply it as one undo step.</p>
            <Button onClick={onOpenGenerator}>Open generator</Button>
          </section>
        </div>
      )}

      {tab === "project" && (
        <div id="browser-project" role="tabpanel" aria-labelledby="browser-project-tab" className="browser-section">
          {project.tracks.filter((track) => track.clips.length).map((track) => (
            <section key={track.id} className="browser-family" aria-label={`${track.name} clips`}>
              <h3>{track.name}</h3>
              <ul>
                {track.clips.map((clip) => (
                  <li key={clip.id}>
                    <button type="button" className="browser-item" disabled={clip.kind !== "midi"}
                      onClick={() => onOpenClip({ trackId: track.id, clipId: clip.id })}>
                      <span>{clip.name}</span>
                      <small>bar {clip.range.start.bar + 1} · {Math.round(clip.range.durationTicks / barTicks(project))} bars</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!project.tracks.some((track) => track.clips.length) && <p className="browser-help">No clips yet.</p>}
          <section className="browser-family" aria-label="Renders">
            <h3>Renders</h3>
            <p className="browser-help">Renders and their downloads are in Export.</p>
            <Button onClick={onExport}>Open Export</Button>
          </section>
        </div>
      )}
    </div>
  );
}
