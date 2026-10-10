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

test("project rename is one undoable history entry on v1 and v2 projects", async () => {
  const { RenameProjectEditorCommand, normalizeProjectName, PROJECT_NAME_MAX_LENGTH } = await import("./editor.ts");
  const { migrateProjectV1ToV2 } = await import("@synaptix/project-model/v2");
  const { createEmptyProject } = await import("@synaptix/project-model");
  const v1 = createEmptyProject("project-rename", { revisionId: "r1", now: "2026-09-26T00:00:00.000Z", name: "Untitled Project" });

  const command = new RenameProjectEditorCommand(v1.metadata.name, "  Night   Drive  ");
  assert.equal(command.nextName, "Night Drive");
  const renamed = command.execute(v1);
  assert.equal(renamed.metadata.name, "Night Drive");
  assert.equal(v1.metadata.name, "Untitled Project");
  assert.equal(command.undo(renamed).metadata.name, "Untitled Project");

  const v2 = migrateProjectV1ToV2(v1);
  const history = new EditorCommandHistory<typeof v2>();
  const result = await history.execute(v2, new RenameProjectEditorCommand(v2.metadata.name, "Sunrise"));
  assert.equal(result.project.metadata.name, "Sunrise");
  assert.equal(result.project.schemaVersion, 2);
  assert.equal((await history.undo(result.project))!.project.metadata.name, "Untitled Project");

  assert.throws(() => normalizeProjectName("   "), RangeError);
  assert.equal(normalizeProjectName("x".repeat(500)).length, PROJECT_NAME_MAX_LENGTH);
});

test("the loop brace sets range and on/off as one undo step, and refuses an empty loop", async () => {
  const { SetLoopRegionEditorCommand } = await import("./editor.ts");
  const project = createEmptyProject("loop-region", { revisionId: "r1", now: "2026-10-10T00:00:00.000Z" });
  const range = { start: { bar: 8, beat: 0, tick: 0 }, durationTicks: 4 * 3840 };
  const history = new EditorCommandHistory();
  const looped = await history.execute(project, new SetLoopRegionEditorCommand(
    { enabled: false, range: null }, { enabled: true, range }
  ));
  assert.equal(looped.project.transport.loopEnabled, true);
  assert.deepEqual(looped.project.transport.loopRange, range);
  // The command keeps its own copy: later changes to the caller's object can't leak into history.
  range.durationTicks = 1;
  assert.equal(looped.project.transport.loopRange!.durationTicks, 4 * 3840);
  const undone = (await history.undo(looped.project))!.project;
  assert.equal(undone.transport.loopEnabled, false);
  assert.equal(undone.transport.loopRange, null);
  assert.throws(() => new SetLoopRegionEditorCommand(
    { enabled: false, range: null }, { enabled: true, range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: 0 } }
  ), /longer than zero/);
});

test("marker edits are one undo step each and refuse duplicate ids or blank names", async () => {
  const { SetMarkersEditorCommand } = await import("./editor.ts");
  const project = createEmptyProject("markers", { revisionId: "r1", now: "2026-10-10T00:00:00.000Z" });
  const drop = { id: "m-drop", name: "Drop", kind: "section" as const, position: { bar: 8, beat: 0, tick: 0 } };
  const history = new EditorCommandHistory();
  const added = await history.execute(project, new SetMarkersEditorCommand([], [drop]));
  const renamed = await history.execute(added.project, new SetMarkersEditorCommand(added.project.markers, [{ ...drop, name: "Big drop" }]));
  assert.equal(renamed.project.markers[0]!.name, "Big drop");
  assert.equal((await history.undo(renamed.project))!.project.markers[0]!.name, "Drop");
  assert.throws(() => new SetMarkersEditorCommand([], [drop, { ...drop }]), /unique/);
  assert.throws(() => new SetMarkersEditorCommand([], [{ ...drop, name: "  " }]), /name/);
});

test("the project key is set and cleared as undo steps, and clearing restores the original checksum", async () => {
  const { SetProjectKeyEditorCommand } = await import("./editor.ts");
  const { computeProjectChecksum } = await import("./index.ts");
  const { migrateProjectV1ToV2 } = await import("@synaptix/project-model/v2");
  const project = createEmptyProject("project-key", { revisionId: "r1", now: "2026-10-10T00:00:00.000Z" });
  const original = await computeProjectChecksum(project);
  const history = new EditorCommandHistory();
  const keyed = await history.execute(project, new SetProjectKeyEditorCommand(undefined, { tonic: 9, mode: "minor" }));
  assert.deepEqual(keyed.project.key, { tonic: 9, mode: "minor" });
  assert.notEqual(await computeProjectChecksum(keyed.project), original);
  const undone = (await history.undo(keyed.project))!.project;
  assert.equal("key" in undone, false);
  // The history stamps revisions, so check the checksum on the command alone: clearing removes the
  // field, leaving the project byte-identical to one that never had a key.
  const command = new SetProjectKeyEditorCommand(undefined, { tonic: 9, mode: "minor" });
  assert.equal(await computeProjectChecksum(command.undo(command.execute(project))), original);
  // v2 projects carry the key too.
  const v2 = new SetProjectKeyEditorCommand(undefined, { tonic: 3, mode: "dorian" }).execute(migrateProjectV1ToV2(project));
  assert.deepEqual(v2.key, { tonic: 3, mode: "dorian" });
  assert.throws(() => new SetProjectKeyEditorCommand(undefined, { tonic: 12, mode: "major" }), /pitch class/);
});
