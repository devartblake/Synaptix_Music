"use client";

import { useEffect, useRef, useState } from "react";
import { PROJECT_NAME_MAX_LENGTH } from "@synaptix/command-system/editor";

/**
 * The studio's project name with inline renaming. A rename is an ordinary editor command, so it
 * is undoable, saved as a revision, and synced like any other edit. Opens straight into editing
 * when the studio is reached with `?rename=1` (the Library's "Rename" action).
 */
export function ProjectTitle({ name, disabled, onRename }: {
  name: string;
  disabled: boolean;
  onRename(next: string): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const committing = useRef(false);

  useEffect(() => {
    if (disabled || new URLSearchParams(window.location.search).get("rename") !== "1") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("rename");
    window.history.replaceState(null, "", url);
    setDraft(name);
    setEditing(true);
    // Only on the first enabled render; later name changes must not reopen the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function start() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function finish() {
    setEditing(false);
    setError(null);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  async function commit() {
    if (committing.current) return;
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next) return setError("Enter a name.");
    if (next === name) return finish();
    committing.current = true;
    try {
      await onRename(next);
      finish();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't rename the project.");
    } finally {
      committing.current = false;
    }
  }

  if (!editing) {
    return (
      <div className="studio-project-name">
        <h1>{name}</h1>
        <button ref={buttonRef} type="button" className="studio-rename" onClick={start} disabled={disabled}
          aria-label={`Rename project ${name}`} title="Rename project">✎</button>
      </div>
    );
  }

  return (
    <form className="studio-rename-form" onSubmit={(event) => { event.preventDefault(); void commit(); }}>
      <label className="visually-hidden" htmlFor="studio-project-name">Project name</label>
      <input id="studio-project-name" ref={inputRef} value={draft} maxLength={PROJECT_NAME_MAX_LENGTH}
        aria-invalid={error ? true : undefined} aria-describedby={error ? "studio-project-name-error" : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); finish(); } }}
        onBlur={() => void commit()} />
      {error && <span id="studio-project-name-error" role="alert">{error}</span>}
    </form>
  );
}
