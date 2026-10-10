import {
  NOTEBOOK_BODY_MAX_LENGTH,
  NOTEBOOK_TITLE_MAX_LENGTH,
  STICKY_NOTE_TEXT_MAX_LENGTH,
  type NotebookPage,
  type StickyNote
} from "@synaptix/project-model";

export { NOTEBOOK_BODY_MAX_LENGTH, NOTEBOOK_TITLE_MAX_LENGTH, STICKY_NOTE_TEXT_MAX_LENGTH };

/** A checklist line in a notebook page: "[ ] Task" or "[x] Done" (leading spaces allowed). */
const CHECK_LINE = /^(\s*)\[( |x|X)\](\s?)(.*)$/;

export interface ChecklistItem {
  /** The line it's on in the page body. */
  line: number;
  text: string;
  done: boolean;
}

export function checklistItems(body: string): ChecklistItem[] {
  return body.split("\n").flatMap((raw, line) => {
    const match = CHECK_LINE.exec(raw);
    return match ? [{ line, text: match[4]!.trim(), done: match[2] !== " " }] : [];
  });
}

/** The body with the checklist item on [line] ticked or unticked; other lines are unchanged. */
export function toggleChecklistItem(body: string, line: number): string {
  const lines = body.split("\n");
  const match = CHECK_LINE.exec(lines[line] ?? "");
  if (!match) return body;
  lines[line] = `${match[1]}[${match[2] === " " ? "x" : " "}]${match[3]}${match[4]}`;
  return lines.join("\n");
}

/** The body with a new, empty checklist item at the end. */
export function appendChecklistItem(body: string): string {
  return body === "" || body.endsWith("\n") ? `${body}[ ] ` : `${body}\n[ ] `;
}

/** A new page, titled "Page N" with the first number not already used. */
export function newNotebookPage(pages: readonly NotebookPage[], id: string = crypto.randomUUID()): NotebookPage {
  const titles = new Set(pages.map((page) => page.title));
  let number = pages.length + 1;
  while (titles.has(`Page ${number}`)) number += 1;
  return { id, title: `Page ${number}`, body: "" };
}

/** A page title as typed, trimmed and cut to length; blank keeps the old title. */
export function cleanTitle(typed: string, previous: string): string {
  const title = typed.trim().slice(0, NOTEBOOK_TITLE_MAX_LENGTH);
  return title || previous;
}

/** Sticky note text as typed, trimmed and cut to length; null when blank (the note is removed). */
export function cleanStickyText(typed: string): string | null {
  const text = typed.trim().slice(0, STICKY_NOTE_TEXT_MAX_LENGTH);
  return text || null;
}

export function newStickyNote(text: string, id: string = crypto.randomUUID()): StickyNote {
  return { id, text };
}
