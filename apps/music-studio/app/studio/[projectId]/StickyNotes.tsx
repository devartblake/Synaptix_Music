"use client";

import { useState } from "react";

import type { StickyNote } from "@synaptix/project-model";
import { Button, DisclosureMenu } from "../../../components/ui/StudioControls";
import { cleanStickyText, newStickyNote, STICKY_NOTE_TEXT_MAX_LENGTH } from "../../../lib/editor/notes";

/**
 * Sticky notes on a track or the project. Each note saves when focus leaves it (one undo step);
 * clearing a note's text deletes it. [owner] names what they're on, e.g. "Bass" or "this project".
 */
export function StickyNotesEditor({ notes, owner, disabled, onChange }: {
  notes: readonly StickyNote[];
  owner: string;
  disabled?: boolean;
  /** Applied to the latest notes when the edit runs, so quick successive saves never undo each other. */
  onChange: (update: (notes: StickyNote[]) => StickyNote[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const text = cleanStickyText(draft);
    if (!text) return;
    const note = newStickyNote(text);
    onChange((current) => [...current, note]);
    setDraft("");
  };
  return (
    <div className="sticky-notes">
      {notes.length > 0 && <ul aria-label={`Sticky notes on ${owner}`}>
        {notes.map((note, index) => (
          // Keyed by text too, so an undo that changes a note shows its restored text.
          <StickyNoteItem key={`${note.id}:${note.text}`} note={note} number={index + 1} disabled={disabled}
            onSave={(text) => onChange((current) => text === null
              ? current.filter((candidate) => candidate.id !== note.id)
              : current.map((candidate) => candidate.id === note.id ? { ...candidate, text } : candidate))} />
        ))}
      </ul>}
      <div className="sticky-note-new">
        <textarea aria-label={`New sticky note on ${owner}`} placeholder="Write a note…" rows={2}
          maxLength={STICKY_NOTE_TEXT_MAX_LENGTH} value={draft} disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); add(); }
          }} />
        <Button aria-label={`Add note to ${owner}`} disabled={disabled || !cleanStickyText(draft)} onClick={add}>Add note</Button>
      </div>
    </div>
  );
}

function StickyNoteItem({ note, number, disabled, onSave }: {
  note: StickyNote;
  number: number;
  disabled?: boolean;
  onSave: (text: string | null) => void;
}) {
  const [text, setText] = useState(note.text);
  return (
    <li className="sticky-note">
      <textarea aria-label={`Sticky note ${number}`} rows={2} maxLength={STICKY_NOTE_TEXT_MAX_LENGTH}
        value={text} disabled={disabled}
        onChange={(event) => setText(event.currentTarget.value)}
        onBlur={() => {
          const next = cleanStickyText(text);
          if (next !== note.text) onSave(next);
        }} />
      <Button className="sticky-note-delete" aria-label={`Delete sticky note ${number}`} title="Delete note (undo restores it)"
        disabled={disabled} onClick={() => onSave(null)}>×</Button>
    </li>
  );
}

/** A track header's sticky notes: the first note's text (or a quiet "add" button), opening a movable panel. */
export function TrackStickyNotes({ trackName, notes, disabled, onChange }: {
  trackName: string;
  notes: readonly StickyNote[];
  disabled?: boolean;
  onChange: (update: (notes: StickyNote[]) => StickyNote[]) => void;
}) {
  const first = notes[0];
  const count = notes.length;
  return (
    <span className="track-sticky" data-empty={count === 0 ? true : undefined}>
      <DisclosureMenu label={`${trackName} notes`} floating trigger={{
        label: count ? `Sticky notes on ${trackName} (${count})` : `Add a sticky note to ${trackName}`,
        className: "track-sticky-trigger",
        content: <>
          <span aria-hidden="true" className="track-sticky-glyph">✎</span>
          {first && <span className="track-sticky-text">{first.text}</span>}
          {count > 1 && <span className="track-sticky-more">+{count - 1}</span>}
        </>
      }}>
        <StickyNotesEditor notes={notes} owner={trackName} disabled={disabled} onChange={onChange} />
      </DisclosureMenu>
    </span>
  );
}
