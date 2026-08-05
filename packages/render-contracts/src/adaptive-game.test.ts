import assert from "node:assert/strict";
import test from "node:test";

import {
  ADAPTIVE_GAME_AUDIO_CONTRACT_VERSION,
  AdaptiveGameAudioManifestSchema,
  AdaptiveRuntimeEventSchema
} from "./adaptive-game.ts";

const checksum = "a".repeat(64);
const artifactA = "11111111-1111-4111-8111-111111111111";
const artifactB = "22222222-2222-4222-8222-222222222222";

function manifest() {
  return {
    contractVersion: ADAPTIVE_GAME_AUDIO_CONTRACT_VERSION,
    packageId: "33333333-3333-4333-8333-333333333333",
    projectId: "project-1",
    revisionId: "revision-1",
    projectChecksumSha256: checksum,
    renderEngineVersion: "1.0.0",
    defaultStateId: "calm",
    states: [
      {
        stateId: "calm",
        displayName: "Calm",
        intensity: 0.25,
        masterArtifactId: artifactA,
        stemArtifactIds: [],
        loopStartSeconds: 0,
        loopEndSeconds: 16,
        entryCueSeconds: 0,
        exitCueSeconds: 15.5,
        tags: ["exploration"]
      },
      {
        stateId: "danger",
        displayName: "Danger",
        intensity: 0.85,
        masterArtifactId: artifactB,
        stemArtifactIds: [],
        loopStartSeconds: 0,
        loopEndSeconds: 16,
        entryCueSeconds: 0,
        exitCueSeconds: 15.5,
        tags: ["combat"]
      }
    ],
    transitions: [
      {
        transitionId: "calm-danger",
        fromStateId: "calm",
        toStateId: "danger",
        trigger: "next-bar",
        crossfadeMilliseconds: 500,
        cuePointId: null,
        minimumSourcePlaybackSeconds: 2
      }
    ],
    cuePoints: [],
    createdAt: "2026-08-05T21:00:00.000Z"
  };
}

test("accepts a deterministic adaptive package manifest", () => {
  const result = AdaptiveGameAudioManifestSchema.parse(manifest());
  assert.equal(result.states.length, 2);
  assert.equal(result.defaultStateId, "calm");
});

test("rejects transitions that reference unknown states", () => {
  const value = manifest();
  value.transitions[0]!.toStateId = "missing";
  assert.equal(AdaptiveGameAudioManifestSchema.safeParse(value).success, false);
});

test("rejects invalid loop ranges and duplicate states", () => {
  const value = manifest();
  value.states[1]!.stateId = "calm";
  value.states[0]!.loopEndSeconds = 0;
  assert.equal(AdaptiveGameAudioManifestSchema.safeParse(value).success, false);
});

test("validates runtime state, intensity, and stinger events", () => {
  assert.equal(AdaptiveRuntimeEventSchema.safeParse({
    type: "set-intensity",
    eventId: "44444444-4444-4444-8444-444444444444",
    intensity: 0.7,
    requestedAtMilliseconds: 1000
  }).success, true);
  assert.equal(AdaptiveRuntimeEventSchema.safeParse({
    type: "set-intensity",
    eventId: "44444444-4444-4444-8444-444444444444",
    intensity: 1.5,
    requestedAtMilliseconds: 1000
  }).success, false);
});
