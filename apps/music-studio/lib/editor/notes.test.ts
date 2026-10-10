import assert from "node:assert/strict";
import test from "node:test";

import { appendChecklistItem, checklistItems, cleanStickyText, cleanTitle, newNotebookPage, toggleChecklistItem } from "./notes.ts";
import { parseStudioSettings } from "./use-studio-settings.ts";

test("checklist lines are found and toggled without touching the rest of the page", () => {
  const body = "Mix notes\n[ ] Brighter hats\n  [x] Sidechain the pad\n[] not an item";
  assert.deepEqual(checklistItems(body), [
    { line: 1, text: "Brighter hats", done: false },
    { line: 2, text: "Sidechain the pad", done: true }
  ]);
  assert.equal(toggleChecklistItem(body, 1), "Mix notes\n[x] Brighter hats\n  [x] Sidechain the pad\n[] not an item");
  assert.equal(toggleChecklistItem(body, 2), "Mix notes\n[ ] Brighter hats\n  [ ] Sidechain the pad\n[] not an item");
  assert.equal(toggleChecklistItem(body, 0), body);
  assert.equal(appendChecklistItem(""), "[ ] ");
  assert.equal(appendChecklistItem("Ideas"), "Ideas\n[ ] ");
  assert.equal(appendChecklistItem("Ideas\n"), "Ideas\n[ ] ");
});

test("new pages take the first free number, and titles and sticky text are cleaned", () => {
  assert.equal(newNotebookPage([], "a").title, "Page 1");
  assert.equal(newNotebookPage([{ id: "a", title: "Page 2", body: "" }], "b").title, "Page 3");
  assert.equal(cleanTitle("  Lyrics ", "Page 1"), "Lyrics");
  assert.equal(cleanTitle("   ", "Page 1"), "Page 1");
  assert.equal(cleanTitle("x".repeat(90), "Page 1").length, 80);
  assert.equal(cleanStickyText("  Check the low end "), "Check the low end");
  assert.equal(cleanStickyText(" \n "), null);
  assert.equal(cleanStickyText("x".repeat(600))!.length, 500);
});

test("settings default to on and ignore bad stored values", () => {
  assert.deepEqual(parseStudioSettings(null), { notebook: true, stickyNotes: true });
  assert.deepEqual(parseStudioSettings("{bad"), { notebook: true, stickyNotes: true });
  assert.deepEqual(parseStudioSettings(JSON.stringify({ notebook: false, stickyNotes: "no" })), { notebook: false, stickyNotes: true });
});
