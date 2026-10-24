import assert from "node:assert/strict";
import test from "node:test";

import { disclosureText, type PackageProvenance } from "./index.ts";

// Publication rules v1, decisions 5 and 6: store disclosure text and credits come from the
// provenance record, so they never claim more (or less) than the platform knows.

const claude: PackageProvenance = {
  origin: "edited",
  generatorId: "synaptix-claude-composer",
  model: "claude-x",
  licence: "Anthropic-Commercial-Terms",
  commercialUse: "allowed",
  editShare: 0.35
};

test("AI-assisted music is disclosed as pre-generated, naming the model and how much was edited", () => {
  const text = disclosureText(claude);
  assert.equal(text.steamCategory, "Pre-generated");
  assert.match(text.long, /Anthropic's Claude/);
  assert.match(text.long, /about 35% of the notes were edited by hand/);
  assert.match(text.long, /No music is generated while the game runs\./);
  assert.equal(text.short, "Music pre-generated with AI (Anthropic's Claude), 35% edited by hand.");
});

test("screening is only claimed when the music passed the melody check", () => {
  assert.doesNotMatch(disclosureText(claude).long, /screened/);
  assert.match(disclosureText(claude, { screened: true }).long, /screened for melodic similarity/);
});

test("unedited music says so, and the rule-based composer isn't called AI", () => {
  const procedural = disclosureText({ origin: "generated", generatorId: "synaptix-procedural-composer" });
  assert.match(procedural.long, /not edited by hand/);
  assert.match(procedural.long, /no machine-learning model/);
  assert.doesNotMatch(procedural.short, /with AI/);
});

test("hand-composed music needs no AI category", () => {
  const hand = disclosureText({ origin: "hand" });
  assert.equal(hand.steamCategory, null);
  assert.equal(hand.short, "Music composed by hand, without AI.");
});

test("credits the model's licence requires are passed through", () => {
  const stability = disclosureText({ ...claude, credits: ["Powered by Stability AI"] });
  assert.deepEqual(stability.credits, ["Powered by Stability AI"]);
  assert.deepEqual(disclosureText(claude).credits, []);
});
