import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyProject, defaultMixer } from "@synaptix/project-model";
import { computeProjectChecksum } from "@synaptix/command-system";
import { createExportManifest, safeDownloadUrl, type ExportOptions } from "./render-export-model.ts";

const options: ExportOptions = { scope: "master", format: "wav", sampleRate: 48000, bitDepth: 24, tail: 2, normalize: false, trackIds: ["track"] };
test("export anchors the exact mixer-bearing project revision and validates stems", async () => {
  const project = createEmptyProject("export");
  project.tracks = [{ id: "track", name: "Bass", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, devices: [], clips: [] }];
  project.mixer = defaultMixer(); project.mixer.master.volumeDb = -6;
  const manifest = await createExportManifest(project, options);
  assert.equal(manifest.projectChecksumSha256, await computeProjectChecksum(project));
  assert.equal(manifest.revisionId, project.revisionId);
  assert.equal(manifest.range.endTick, 15360);
  await assert.rejects(createExportManifest(project, { ...options, scope: "stems", trackIds: [] }));
  await assert.rejects(createExportManifest(project, { ...options, scope: "stems", trackIds: ["missing"] }));
  const stems = await createExportManifest(project, { ...options, scope: "stems", normalize: true });
  assert.equal(stems.output.normalizePeakDbfs, -1);
});
test("download links reject executable URLs and embedded credentials", () => {
  assert.equal(safeDownloadUrl("https://example.com/master.wav?token=abc"), "https://example.com/master.wav?token=abc");
  for (const url of ["javascript:alert(1)", "data:text/html,example", "https://user:pass@example.com", "/relative", null]) assert.throws(() => safeDownloadUrl(url));
});
