import {
  GENERATION_KEYS,
  splitKey,
  type GenerationKey,
  type GenerationProposal,
  type GenerationRequest,
  type KeyMode
} from "@synaptix/generator-contracts";
import type { GenerationJobRequest } from "@synaptix/platform-contracts";

export const GENERATION_PRESETS = [
  { id: "bright-round", name: "Bright Round", description: "Upbeat, readable gameplay loop", mood: "upbeat", tempo: 120, key: "D minor", energy: 0.62, complexity: 0.48 },
  { id: "pressure-rise", name: "Pressure Rise", description: "Tense countdown and challenge bed", mood: "tense", tempo: 128, key: "E minor", energy: 0.8, complexity: 0.68 },
  { id: "victory-lap", name: "Victory Lap", description: "Triumphant result and reward loop", mood: "triumphant", tempo: 124, key: "G minor", energy: 0.86, complexity: 0.58 },
  { id: "adventure-route", name: "Adventure Route", description: "Bright, heroic handheld-RPG travel theme", mood: "upbeat", tempo: 156, key: "C major", energy: 0.78, complexity: 0.55 },
  { id: "villain-encounter", name: "Villain Encounter", description: "Dramatic boss theme with a sinister edge", mood: "tense", tempo: 136, key: "A harmonic minor", energy: 0.88, complexity: 0.7 }
] as const satisfies readonly {
  id: string;
  name: string;
  description: string;
  mood: GenerationRequest["mood"];
  tempo: number;
  key: GenerationRequest["key"];
  energy: number;
  complexity: number;
}[];

export type GenerationPresetId = typeof GENERATION_PRESETS[number]["id"];

export interface GenerationForm {
  presetId: GenerationPresetId;
  mood: GenerationRequest["mood"];
  tempo: number;
  key: GenerationRequest["key"];
  durationBars: number;
  energy: number;
  complexity: number;
  seed: number;
}

export function formForPreset(presetId: GenerationPresetId, seed = 1): GenerationForm {
  const preset = GENERATION_PRESETS.find((candidate) => candidate.id === presetId) ?? GENERATION_PRESETS[0];
  return { ...preset, presetId: preset.id, durationBars: 16, seed };
}

export function interpretCreativeBrief(form: GenerationForm, brief: string): GenerationForm {
  const normalized = brief.trim().toLowerCase();
  if (!normalized) return form;
  const mood: GenerationForm["mood"] = /victory|triumph|reward|win|celebrat/.test(normalized)
    ? "triumphant"
    : /tense|boss|danger|countdown|pressure|suspense/.test(normalized)
      ? "tense"
      : /upbeat|bright|fun|playful|quiz/.test(normalized)
        ? "upbeat"
        : form.mood;
  const highEnergy = /fast|intense|high[- ]energy|driving|urgent|up[- ]?tempo/.test(normalized);
  // "up-tempo" and "very fast" ask for real speed, beyond the general high-energy bump.
  const upTempo = /up[- ]?tempo|very fast|breakneck/.test(normalized);
  const lowEnergy = /calm|soft|low[- ]energy|ambient|gentle/.test(normalized);
  return {
    ...form,
    mood,
    key: keyFromBrief(form.key, normalized),
    tempo: upTempo ? Math.max(form.tempo, 152) : highEnergy ? Math.max(form.tempo, 132) : lowEnergy ? Math.min(form.tempo, 100) : form.tempo,
    energy: highEnergy ? Math.max(form.energy, 0.85) : lowEnergy ? Math.min(form.energy, 0.38) : form.energy,
    complexity: /complex|layered|technical/.test(normalized) ? Math.max(form.complexity, 0.75) : form.complexity
  };
}

const MODE_WORDS: [RegExp, KeyMode][] = [
  [/harmonic minor|villain|evil|sinister|dark lord|menac/, "harmonic minor"],
  [/phrygian|mysterious|ominous|desert|exotic/, "phrygian"],
  [/lydian|dream|magic|fairy|floating|wonder/, "lydian"],
  [/mixolydian|blues|groov|funk|swagger/, "mixolydian"],
  [/dorian|jazz|\bcool\b|sneak/, "dorian"],
  // "major"/"minor" alone are ordinary words ("a major battle"), so they need musical context.
  [/\bin major\b|\bmajor (key|mode|scale)\b|heroic|happy|adventure|joyful|sunny|pok[eé]mon|route theme/, "major"],
  [/\bin minor\b|\bminor (key|mode|scale)\b|\bsad\b|melanchol|serious/, "minor"]
];

/** Whether the text names this key as the key ("in C major", "key of C major", "C major key"). */
function namesKey(text: string, key: GenerationKey): boolean {
  const name = key.toLowerCase();
  return [`in ${name}`, `key of ${name}`, `${name} key`].some((phrase) => {
    const at = text.indexOf(phrase);
    if (at < 0) return false;
    const before = text[at - 1] ?? " ";
    const after = text[at + phrase.length] ?? " ";
    return !/[a-z0-9#]/.test(before) && !/[a-z0-9#]/.test(after);
  });
}

/**
 * An explicit key in the brief ("in C major", "key of F# dorian") wins. Otherwise words that
 * suggest a mode change the mode and keep the tonic.
 */
function keyFromBrief(current: GenerationKey, normalized: string): GenerationKey {
  // Longest names first, so "a harmonic minor" isn't read as "a minor".
  const explicit = [...GENERATION_KEYS].sort((a, b) => b.length - a.length).find((key) => namesKey(normalized, key));
  if (explicit) return explicit;
  const mode = MODE_WORDS.find(([pattern]) => pattern.test(normalized))?.[1];
  return mode ? `${splitKey(current).tonic} ${mode}` : current;
}

export function buildGenerationJobRequest(
  projectId: string,
  revisionId: string,
  form: GenerationForm,
  idempotencyKey: string,
  correlationId: string,
  requestedAt = new Date().toISOString(),
  brief?: string
): GenerationJobRequest {
  const trimmedBrief = brief?.trim().slice(0, 2000);
  return {
    idempotencyKey,
    correlationId,
    projectId,
    expectedRevisionId: revisionId,
    requestedAt,
    generation: {
      projectId,
      genre: "electronic-trivia",
      mood: form.mood,
      tempo: form.tempo,
      key: form.key,
      durationBars: form.durationBars,
      energy: form.energy,
      complexity: form.complexity,
      seed: form.seed,
      ...(trimmedBrief ? { brief: trimmedBrief } : {})
    }
  };
}

/** Who wrote a proposal, in words for the generation preview. */
export function composerLabel(provenance: GenerationProposal["provenance"]): string {
  switch (provenance.generatorId) {
    case "synaptix-claude-composer":
      return `Composed by Claude${provenance.model ? ` (${provenance.model})` : ""}`;
    case "synaptix-local-composer":
      return `Composed by a local model${provenance.model ? ` (${provenance.model})` : ""}`;
    default:
      return `Procedural composer · seed ${provenance.seed}`;
  }
}

export function proposalSummary(proposal: GenerationProposal) {
  return {
    sectionCount: proposal.sections.length,
    trackCount: proposal.tracks.length,
    noteCount: proposal.tracks.reduce(
      (total, track) => total + track.clips.reduce((clipTotal, clip) => clipTotal + clip.notes.length, 0),
      0
    ),
    durationBars: proposal.sections.reduce((maximum, section) => Math.max(maximum, section.startBar + section.bars), 0)
  };
}
