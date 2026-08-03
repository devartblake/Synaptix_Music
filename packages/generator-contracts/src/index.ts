import { z } from "zod";
export const GenerationRequestSchema = z.object({ projectId: z.string(), genre: z.string(), mood: z.string(), tempo: z.number().min(40).max(240), key: z.string(), durationSeconds: z.number().min(5).max(900), seed: z.number().int().optional() });
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;
