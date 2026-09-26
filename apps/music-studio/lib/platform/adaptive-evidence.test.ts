import assert from "node:assert/strict";
import test from "node:test";
import { adaptiveFixture, fixtureId } from "../../tests/fixtures/adaptive.ts";
import { verifyAdaptiveEvidence, createAdaptivePublication } from "./adaptive-evidence.ts";
import { buildAdaptiveDraft, eligibleAdaptiveRenders } from "./adaptive-authoring-model.ts";

test("certification rejects tampered bytes, wrong revisions, failed reports and missing artifact evidence", async () => {
  const { fixtures } = adaptiveFixture();
  const { job, report, artifactBytes } = fixtures[0]!;
  assert.equal((await verifyAdaptiveEvidence(report, artifactBytes, job)).jobId, job.jobId);
  await assert.rejects(verifyAdaptiveEvidence({ ...report, passed: false }, artifactBytes, job));
  await assert.rejects(
    verifyAdaptiveEvidence({ ...report, revisionId: "wrong" }, artifactBytes, job)
  );
  await assert.rejects(
    verifyAdaptiveEvidence(report, Buffer.from(artifactBytes.toString() + " "), job)
  );
  await assert.rejects(verifyAdaptiveEvidence({ ...report, artifacts: [] }, artifactBytes, job));
});
test("publication requires evidence and matching locations for every referenced artifact", async () => {
  const { project, jobs, fixtures, locations } = adaptiveFixture();
  const states = jobs.map((job, index) => ({
    jobId: job.jobId,
    stateId: `state-${index}`,
    displayName: `State ${index}`,
    intensity: index,
    tags: []
  }));
  const manifest = buildAdaptiveDraft(fixtureId(99), project.projectId, states, jobs);
  const evidence = await Promise.all(
    fixtures.map((item) => verifyAdaptiveEvidence(item.report, item.artifactBytes, item.job))
  );
  assert.equal(
    createAdaptivePublication(manifest, "Test", jobs, evidence, locations).artifacts.length,
    2
  );
  assert.throws(() =>
    createAdaptivePublication(manifest, "Test", jobs, evidence.slice(0, 1), locations)
  );
  assert.throws(() =>
    createAdaptivePublication(manifest, "Test", jobs, evidence, [
      { ...locations[0], checksumSha256: "b".repeat(64) },
      locations[1]
    ])
  );
});
test("adaptive draft validates loop bounds, duplicate IDs and source cues; metadata and previews are not masters", () => {
  const { project, jobs } = adaptiveFixture();
  const states = jobs.map((job, index) => ({
    jobId: job.jobId,
    stateId: `state-${index}`,
    displayName: `State ${index}`,
    intensity: index,
    tags: []
  }));
  const build = (configuration: Parameters<typeof buildAdaptiveDraft>[4]) =>
    buildAdaptiveDraft(fixtureId(99), project.projectId, states, jobs, configuration);
  assert.throws(() =>
    buildAdaptiveDraft(
      fixtureId(99),
      project.projectId,
      [{ ...states[0]!, loopEndSeconds: 9 }],
      jobs
    )
  );
  assert.throws(() =>
    buildAdaptiveDraft(
      fixtureId(99),
      project.projectId,
      [{ ...states[0]!, entryCueSeconds: 2 }],
      jobs
    )
  );
  assert.throws(() =>
    build({
      transitions: [
        {
          transitionId: "next",
          fromStateId: "state-0",
          toStateId: "state-1",
          trigger: "cue-point",
          cuePointId: "missing",
          crossfadeMilliseconds: 100,
          minimumSourcePlaybackSeconds: 0
        }
      ],
      cuePoints: []
    })
  );
  assert.throws(() =>
    build({
      transitions: [],
      cuePoints: [
        { cuePointId: "late", stateId: "state-0", positionSeconds: 3, semantic: "custom" }
      ]
    })
  );
  const metadataOnly = structuredClone(jobs[0]!);
  metadataOnly.result!.artifacts = metadataOnly.result!.artifacts.filter(
    (item) => item.fileName !== "master.wav"
  );
  assert.equal(eligibleAdaptiveRenders([metadataOnly], project.projectId).length, 0);
});
