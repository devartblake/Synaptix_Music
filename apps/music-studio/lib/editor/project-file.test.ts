import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";
import { toProjectV2 } from "@synaptix/project-model/v2";

import {
  createProjectFile,
  ProjectFileError,
  projectFileName,
  readProjectFile
} from "./project-file.ts";

function project() {
  const value = createEmptyProject("original-id", { name: "Boss Battle: Phase 2!" });
  value.transport.loopEnabled = true;
  return value;
}

test("an exported project imports as a new copy with identical music", async () => {
  const file = await createProjectFile(project(), "2026-09-25T00:00:00.000Z");
  const imported = await readProjectFile(file, "new-id", "2026-09-26T00:00:00.000Z");

  assert.equal(imported.projectId, "new-id", "never reuses the original ID");
  assert.equal(imported.metadata.name, "Boss Battle: Phase 2!");
  assert.equal(imported.metadata.updatedAt, "2026-09-26T00:00:00.000Z");
  assert.equal(imported.transport.loopEnabled, true);
  assert.equal(JSON.parse(file).format, "synaptix-music-project");
});

test("imports refuse edited, damaged, foreign and future files", async () => {
  const file = JSON.parse(await createProjectFile(project()));

  const edited = structuredClone(file);
  edited.project.metadata.name = "Tampered";
  await assert.rejects(readProjectFile(JSON.stringify(edited)), /changed or damaged/);

  const damaged = structuredClone(file);
  delete damaged.project.transport;
  await assert.rejects(readProjectFile(JSON.stringify(damaged)), /incomplete or damaged/);

  await assert.rejects(readProjectFile("{not json"), /isn't valid JSON/);
  await assert.rejects(readProjectFile(JSON.stringify({ hello: 1 })), /isn't a Synaptix Music project file/);
  await assert.rejects(readProjectFile(JSON.stringify({ ...file, version: 9 })), /version 9/);
  await assert.rejects(readProjectFile("[]"), ProjectFileError);
});

test("file names are readable and safe", () => {
  assert.equal(projectFileName(project()), "boss-battle-phase-2.synaptix.json");
  assert.equal(projectFileName(createEmptyProject("x", { name: "***" })), "project.synaptix.json");
});

test("plug-in (schema v2) projects export and import as v2", async () => {
  const file = await createProjectFile(toProjectV2(project()), "2026-09-25T00:00:00.000Z");
  const imported = await readProjectFile(file, "new-id", "2026-09-26T00:00:00.000Z");

  assert.equal(imported.schemaVersion, 2);
  assert.equal(imported.projectId, "new-id");
});
