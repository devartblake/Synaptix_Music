import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdaptiveGameAudioManifest,
  findAdaptiveTransition,
  planAdaptiveTransition,
  selectAdaptiveState
} from "./adaptive-runtime.ts";

const artifactId = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function manifest() {
  return buildAdaptiveGameAudioManifest({
    packageId: artifactId("1"),
    projectId: "project-1",
    revisionId: "revision-7",
    projectChecksumSha256: "a".repeat(64),
    renderEngineVersion: "render-1.0.0",
    defaultStateId: "calm",
    createdAt: "2026-08-05T21:45:00.000Z",
    artifacts: [
      {
        artifactId: artifactId("2"),
        stateId: "calm",
        displayName: "Calm",
        intensity: 0.2,
        durationSeconds: 16,
        tags: ["exploration", "exploration"]
      },
      {
        artifactId: artifactId("3"),
        stateId: "combat",
        displayName: "Combat",
        intensity: 0.9,
        durationSeconds: 16,
        tags: ["combat"]
      }
    ],
    transitions: [
      {
        transitionId: "calm-to-combat",
        fromStateId: "calm",
        toStateId: "combat",
        trigger: "next-bar",
        crossfadeMilliseconds: 500,
        cuePointId: null,
        minimumSourcePlaybackSeconds: 0
      }
    ]
  });
}

test("builds a deterministic adaptive package from certified artifacts", () => {
  const result = manifest();
  assert.equal(result.states[0]?.loopEndSeconds, 16);
  assert.deepEqual(result.states[0]?.tags, ["exploration"]);
  assert.equal(result.defaultStateId, "calm");
});

test("selects the nearest intensity and respects tags", () => {
  const result = manifest();
  assert.equal(selectAdaptiveState(result, 0.8).stateId, "combat");
  assert.equal(selectAdaptiveState(result, 0.95, ["exploration"]).stateId, "calm");
});

test("finds declared transitions", () => {
  const result = manifest();
  assert.equal(findAdaptiveTransition(result, "calm", "combat")?.transitionId, "calm-to-combat");
  assert.equal(findAdaptiveTransition(result, "combat", "calm"), null);
});

test("plans bar-quantized transitions", () => {
  const transition = manifest().transitions[0]!;
  const planned = planAdaptiveTransition(
    transition,
    1_100,
    4_000,
    { beatsPerMinute: 120, beatsPerBar: 4, barsPerPhrase: 4 }
  );
  assert.equal(planned.executeAtMilliseconds, 2_000);
  assert.equal(planned.delayMilliseconds, 900);
});

test("rejects invalid certified artifact duration", () => {
  assert.throws(
    () =>
      buildAdaptiveGameAudioManifest({
        packageId: artifactId("4"),
        projectId: "project-1",
        revisionId: "revision-1",
        projectChecksumSha256: "b".repeat(64),
        renderEngineVersion: "render-1",
        defaultStateId: "bad",
        createdAt: "2026-08-05T21:45:00.000Z",
        artifacts: [
          {
            artifactId: artifactId("5"),
            stateId: "bad",
            displayName: "Bad",
            intensity: 0.5,
            durationSeconds: 0
          }
        ]
      }),
    /must be positive/
  );
});
