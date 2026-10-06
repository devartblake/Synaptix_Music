import assert from "node:assert/strict";
import test from "node:test";

import { AudioJobSchema, describeJob, isFinished, newerJob, type AudioJob } from "./job-model.ts";

const base: AudioJob = { jobId: "a".repeat(32), status: "queued", progress: 0, position: 0, error: null, version: 1 };

test("status lines say where the job is", () => {
  assert.equal(describeJob(base), "Queued: starting next.");
  assert.equal(describeJob({ ...base, position: 1 }), "Queued: 1 clip ahead.");
  assert.equal(describeJob({ ...base, position: 3 }), "Queued: 3 clips ahead.");
  assert.match(describeJob({ ...base, status: "loading" }), /Loading the model/);
  assert.equal(describeJob({ ...base, status: "generating", progress: 0.456 }), "Generating: 45%.");
  assert.equal(describeJob({ ...base, status: "failed", error: "No GPU." }), "No GPU.");
});

test("finished states and ordering", () => {
  assert.equal(isFinished({ ...base, status: "completed" }), true);
  assert.equal(isFinished({ ...base, status: "generating" }), false);
  const later = { ...base, status: "generating" as const, progress: 0.5, version: 5 };
  assert.equal(newerJob(later, { ...base, version: 2 }), later, "an older event doesn't win");
  const done = { ...base, status: "completed" as const, progress: 1, version: 9 };
  assert.equal(newerJob(done, { ...later, version: 10 }), done, "a finished job stays finished");
  const other = { ...base, jobId: "b".repeat(32) };
  assert.equal(newerJob(later, other), other, "a different job replaces the old one");
});

test("the schema rejects malformed job ids and progress", () => {
  assert.equal(AudioJobSchema.safeParse({ ...base, jobId: "../x" }).success, false);
  assert.equal(AudioJobSchema.safeParse({ ...base, progress: 2 }).success, false);
});
