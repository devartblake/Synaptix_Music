/*
 * The readable half of AI marking (publication-rules-v1, phase 2): metadata tags that players and
 * tools which don't read C2PA still show. MP3 gets ID3 TXXX frames and OGG Vorbis comments (both
 * written by FFmpeg from these tags); WAV gets a LIST/INFO chunk. Only music with AI involvement is
 * tagged; hand-composed music carries no AI tags (its C2PA record says it is human work).
 */

export type AiTags = Record<string, string>;

interface TaggableProject {
  generationMetadata?: {
    generatorId: string;
    provenance?: { model?: string; licence?: string };
  };
}

export function aiTags(project: TaggableProject): AiTags | null {
  const generation = project.generationMetadata;
  if (!generation) return null;
  return {
    AI_GENERATED: "true",
    AI_GENERATOR: generation.generatorId,
    ...(generation.provenance?.model ? { AI_MODEL: generation.provenance.model } : {}),
    ...(generation.provenance?.licence ? { AI_LICENSE: generation.provenance.licence } : {})
  };
}

function infoSubchunk(id: string, text: string): Buffer {
  const value = Buffer.from(`${text}\0`, "utf8");
  const padded = value.length % 2 === 0 ? value : Buffer.concat([value, Buffer.alloc(1)]);
  const header = Buffer.alloc(8);
  header.write(id, 0, "ascii");
  header.writeUInt32LE(value.length, 4);
  return Buffer.concat([header, padded]);
}

/** The WAV with a LIST/INFO chunk: ICMT holds the tags as `KEY=value; ...`, ISFT names the software. */
export function withWavInfo(wav: Buffer, tags: AiTags): Buffer {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Only RIFF/WAVE files can be tagged.");
  }
  const comment = Object.entries(tags).map(([key, value]) => `${key}=${value}`).join("; ");
  const body = Buffer.concat([
    Buffer.from("INFO", "ascii"),
    infoSubchunk("ICMT", comment),
    infoSubchunk("ISFT", "Synaptix Music")
  ]);
  const header = Buffer.alloc(8);
  header.write("LIST", 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  const tagged = Buffer.concat([wav, header, body]);
  tagged.writeUInt32LE(tagged.length - 8, 4);
  return tagged;
}

/**
 * Music with AI involvement must carry C2PA content credentials, which the C2PA SDK can't bind to
 * OGG, so it isn't delivered as OGG at all (decided 2026-10-19). The studio doesn't offer it; this
 * refuses a direct request, previews included.
 */
export function assertDeliverableFormats(
  project: { generationMetadata?: unknown },
  output: { format: string; preview?: { format: string } }
): void {
  if (!project.generationMetadata) return;
  if (output.format === "ogg" || output.preview?.format === "ogg") {
    throw new Error("OGG isn't offered for music made with AI: it can't carry content credentials. Use WAV or MP3.");
  }
}
