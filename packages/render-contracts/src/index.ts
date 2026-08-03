import { z } from "zod";
export const RenderManifestSchema = z.object({ projectId: z.string(), revisionId: z.string(), format: z.enum(["wav", "mp3", "ogg"]), sampleRate: z.union([z.literal(44100), z.literal(48000)]), bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]) });
