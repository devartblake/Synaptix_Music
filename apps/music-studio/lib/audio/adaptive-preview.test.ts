import assert from "node:assert/strict";
import test from "node:test";
import { adaptiveFixture, fixtureId } from "../../tests/fixtures/adaptive.ts";
import { buildAdaptiveDraft } from "../platform/adaptive-authoring-model.ts";
import { AdaptivePreview } from "./adaptive-preview.ts";

test("preview schedules quantized crossfades, reports the audible state, wraps loops and stops all voices", async () => {
  const { jobs, project } = adaptiveFixture();
  const manifest = buildAdaptiveDraft(
    fixtureId(99),
    project.projectId,
    jobs.map((job, index) => ({
      jobId: job.jobId,
      stateId: String(index),
      displayName: String(index),
      intensity: index,
      tags: []
    })),
    jobs
  );
  const sources: { start: number[]; stop: number[]; disconnected: boolean }[] = [];
  const context = {
    currentTime: 0,
    destination: {},
    resume: async () => {},
    close: async () => {},
    createBufferSource: () => {
      const calls = { start: [] as number[], stop: [] as number[], disconnected: false };
      sources.push(calls);
      return {
        connect() {},
        disconnect() {
          calls.disconnected = true;
        },
        start(time: number) {
          calls.start.push(time);
        },
        stop(time = 0) {
          calls.stop.push(time);
        }
      };
    },
    createGain: () => ({
      connect() {},
      disconnect() {},
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }
    })
  };
  const buffers = new Map(
    manifest.states.map((state) => [state.masterArtifactId, { duration: 2 } as AudioBuffer])
  );
  const preview = new AdaptivePreview(context as unknown as AudioContext, manifest, buffers, {
    beatsPerMinute: 120,
    beatsPerBar: 4,
    barsPerPhrase: 4
  });
  await preview.play();
  context.currentTime = 0.3;
  assert.match(preview.requestIntensity(1), /1700 ms/);
  assert.equal(sources[1]!.start[0], 2);
  assert.equal(sources[0]!.stop[0], 2.5);
  assert.equal(preview.stateId, "0");
  assert.throws(() => preview.requestState("0"), /scheduled transition/);
  context.currentTime = 2.6;
  assert.equal(preview.stateId, "1");
  context.currentTime = 5;
  assert.equal(preview.position, 1);
  preview.triggerStinger(manifest.states[0]!.masterArtifactId);
  assert.equal(sources.length, 3);
  await preview.dispose();
  assert.ok(sources.every((source) => source.disconnected && source.stop.length > 0));
  assert.equal(preview.stateId, null);
});
