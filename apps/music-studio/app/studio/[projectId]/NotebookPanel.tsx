"use client";

import { useEffect, useRef, useState } from "react";

import type { NotebookPage } from "@synaptix/project-model";
import { Button } from "../../../components/ui/StudioControls";
import {
  appendChecklistItem,
  checklistItems,
  cleanTitle,
  newNotebookPage,
  NOTEBOOK_BODY_MAX_LENGTH,
  NOTEBOOK_TITLE_MAX_LENGTH,
  toggleChecklistItem
} from "../../../lib/editor/notes";

/**
 * The project notebook (in the DAW layout's Notebook drawer): titled pages of plain text, saved
 * with the project. Typing saves when focus leaves the page or the drawer closes, as one undo step;
 * "[ ] " lines are a checklist, ticked below the text.
 */
export function NotebookPanel({ pages, disabled, onChange, onClose }: {
  pages: readonly NotebookPage[];
  disabled?: boolean;
  /** Applied to the latest pages when the edit runs, so quick successive saves never undo each other. */
  onChange: (update: (pages: NotebookPage[]) => NotebookPage[]) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(pages[0]?.id ?? null);
  const page = pages.find((candidate) => candidate.id === selectedId) ?? pages[0] ?? null;
  const addPage = () => {
    const created = newNotebookPage(pages);
    onChange((current) => [...current, created]);
    setSelectedId(created.id);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".notebook-title input")?.select());
  };
  return (
    <div className="notebook-panel">
      <div className="notebook-heading">
        <h2 tabIndex={-1}>Notebook</h2>
        <Button onClick={onClose}>Close</Button>
      </div>
      <p className="notebook-hint">Ideas, lyrics and to-dos for this project. Notes are saved with it, synced and exported.</p>
      <div className="notebook-pages">
        {pages.length > 0 && <label>Page <select value={page?.id ?? ""} onChange={(event) => setSelectedId(event.currentTarget.value)}>
          {pages.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
        </select></label>}
        <Button disabled={disabled} onClick={addPage}>New page</Button>
        {page && <Button disabled={disabled} title="Delete this page (undo restores it)"
          onClick={() => {
            const index = pages.indexOf(page);
            const rest = pages.filter((candidate) => candidate.id !== page.id);
            onChange((current) => current.filter((candidate) => candidate.id !== page.id));
            setSelectedId(rest[Math.min(index, rest.length - 1)]?.id ?? null);
          }}>Delete page</Button>}
      </div>
      {page
        ? <PageEditor key={page.id} page={page} disabled={disabled}
          onSave={(patch) => onChange((current) => current.map((candidate) => candidate.id === page.id ? { ...candidate, ...patch } : candidate))} />
        : <div className="notebook-empty">
          <strong>No pages yet</strong>
          <p>Start a page for ideas, lyrics or a mix checklist.</p>
        </div>}
    </div>
  );
}

function PageEditor({ page, disabled, onSave }: {
  page: NotebookPage;
  disabled?: boolean;
  onSave: (patch: Partial<NotebookPage>) => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  // Undo and redo change the stored page; show what they restored.
  useEffect(() => setTitle(page.title), [page.title]);
  useEffect(() => setBody(page.body), [page.body]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Typing not yet saved is saved when the drawer closes or another page is chosen.
  const latest = useRef({ page, body, onSave });
  latest.current = { page, body, onSave };
  useEffect(() => () => {
    const { page: stored, body: typed, onSave: save } = latest.current;
    if (typed !== stored.body) save({ body: typed });
  }, []);

  const saveTitle = () => {
    const next = cleanTitle(title, page.title);
    setTitle(next);
    if (next !== page.title) onSave({ title: next });
  };
  const saveBody = (next: string) => { if (next !== page.body) onSave({ body: next }); };
  const items = checklistItems(body);
  return (
    <div className="notebook-page">
      <label className="notebook-title">Title
        <input value={title} maxLength={NOTEBOOK_TITLE_MAX_LENGTH} disabled={disabled}
          onChange={(event) => setTitle(event.currentTarget.value)} onBlur={saveTitle}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveTitle(); } }} />
      </label>
      <label className="notebook-body">Page text
        <textarea ref={textRef} value={body} maxLength={NOTEBOOK_BODY_MAX_LENGTH} disabled={disabled} rows={12}
          placeholder={"Write anything. Start a line with [ ] to make a checklist item."}
          onChange={(event) => setBody(event.currentTarget.value)} onBlur={() => saveBody(body)} />
      </label>
      <section className="notebook-checklist" aria-label="Checklist">
        <div className="notebook-checklist-heading">
          <strong>Checklist</strong>
          <span>{items.filter((item) => item.done).length} of {items.length} done</span>
          <Button disabled={disabled} onClick={() => {
            const next = appendChecklistItem(body);
            setBody(next);
            requestAnimationFrame(() => {
              const area = textRef.current;
              if (!area) return;
              area.focus();
              area.setSelectionRange(next.length, next.length);
            });
          }}>Add checklist item</Button>
        </div>
        {items.length > 0 && <ul>
          {items.map((item) => (
            <li key={item.line}>
              <label>
                <input type="checkbox" checked={item.done} disabled={disabled}
                  onChange={() => {
                    const next = toggleChecklistItem(body, item.line);
                    setBody(next);
                    saveBody(next);
                  }} />
                <span>{item.text || "(empty item)"}</span>
              </label>
            </li>
          ))}
        </ul>}
      </section>
    </div>
  );
}
