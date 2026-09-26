import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyProject, MusicProjectSchema } from "@synaptix/project-model";
import { computeProjectChecksum } from "./index.ts";
import { SetMixerChannelEditorCommand, SetTrackOutputEditorCommand, SetTrackSendEditorCommand } from "./editor.ts";

test("legacy projects retain checksums and mixer changes undo to an absent configuration", async () => {
  const project = createEmptyProject("legacy");
  const checksum = await computeProjectChecksum(project);
  assert.equal(await computeProjectChecksum(MusicProjectSchema.parse(project)), checksum);
  assert.equal(Object.hasOwn(project, "mixer"), false);
  const command = new SetMixerChannelEditorCommand("master", { volumeDb: -6, muted: true });
  const next = command.execute(project);
  assert.equal(next.mixer?.master.volumeDb, -6);
  assert.equal(next.mixer?.music.volumeDb, 0);
  assert.equal(await computeProjectChecksum(command.undo(next)), checksum);
  assert.equal(command.execute(command.undo(next)).mixer?.master.muted, true);
});

test("routing and send edits validate and preserve the original optional fields on undo", () => {
  const project = createEmptyProject("routing");
  project.tracks = [{ id: "track", name: "Bass", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, devices: [], clips: [] }];
  const route = new SetTrackOutputEditorCommand("track", undefined, "drums");
  assert.equal(route.execute(project).tracks[0]?.outputBusId, "drums");
  assert.deepEqual(route.undo(route.execute(project)), project);
  const send = new SetTrackSendEditorCommand("track", undefined, 0.5);
  assert.equal(send.execute(project).tracks[0]?.reverbSend, 0.5);
  assert.deepEqual(send.undo(send.execute(project)), project);
  assert.throws(() => new SetTrackOutputEditorCommand("track", undefined, "track").execute(project));
  assert.throws(() => new SetTrackSendEditorCommand("track", undefined, 2).execute(project));
  assert.throws(() => new SetMixerChannelEditorCommand("master", { volumeDb: NaN, muted: false }));
});
