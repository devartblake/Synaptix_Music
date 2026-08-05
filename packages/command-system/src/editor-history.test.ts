import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";

import {
  EditorCommandHistory,
  SetLoopEnabledEditorCommand,
  SetTempoEditorCommand
} from "./editor.ts";

function project(id = "project-a") {
  return createEmptyProject(id, { name: "History Test" });
}

test("history enforces a bounded undo depth", async () => {
  const history = new EditorCommandHistory({ maxDepth: 2 });
  let current = project();

  for (const bpm of [121, 122, 123]) {
    const result = await history.execute(
      current,
      new SetTempoEditorCommand(current.tempoMap[0]?.bpm ?? 120, bpm)
    );
    current = result.project;
  }

  assert.equal(history.snapshot().undoDepth, 2);
  assert.equal(history.snapshot().redoDepth, 0);
});

test("new edits invalidate redo history", async () => {
  const history = new EditorCommandHistory();
  let current = project();

  current = (await history.execute(
    current,
    new SetLoopEnabledEditorCommand(false, true)
  )).project;
  current = (await history.undo(current))!.project;
  assert.equal(history.canRedo, true);

  current = (await history.execute(
    current,
    new SetTempoEditorCommand(120, 128)
  )).project;

  assert.equal(history.canRedo, false);
  assert.equal(history.snapshot().redoDepth, 0);
});

test("history must be reset before switching projects", async () => {
  const history = new EditorCommandHistory();
  const first = project("project-a");
  await history.execute(first, new SetLoopEnabledEditorCommand(false, true));

  await assert.rejects(
    history.execute(project("project-b"), new SetLoopEnabledEditorCommand(false, true)),
    /different project/
  );

  const second = project("project-b");
  history.reset(second);
  assert.equal(history.snapshot().projectId, "project-b");
  assert.equal(history.canUndo, false);
});

test("failed command construction leaves history unchanged", () => {
  const history = new EditorCommandHistory();

  assert.throws(
    () => new SetTempoEditorCommand(120, 301),
    /between 20 and 300/
  );

  assert.equal(history.snapshot().undoDepth, 0);
  assert.equal(history.snapshot().redoDepth, 0);
  assert.equal(history.isBusy, false);
});
