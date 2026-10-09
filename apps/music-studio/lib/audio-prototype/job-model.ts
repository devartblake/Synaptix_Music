import { z } from "zod";

/** A prototype-audio job as the studio sees it (mirrors the service's public view). */
export const AudioJobSchema = z.object({
  jobId: z.string().regex(/^[0-9a-f]{32}$/),
  status: z.enum(["queued", "loading", "generating", "completed", "failed", "cancelled"]),
  progress: z.number().min(0).max(1),
  position: z.number().int().nonnegative().nullable(),
  durationSeconds: z.number().nullable().optional(),
  seed: z.number().int().nullable().optional(),
  error: z.string().nullable(),
  version: z.number().int().optional(),
  result: z.object({
    model: z.string().nullable(),
    audioSeconds: z.number().nullable(),
    generationSeconds: z.number().nullable()
  }).optional()
});

export type AudioJob = z.infer<typeof AudioJobSchema>;

export function isFinished(job: AudioJob): boolean {
  return job.status === "completed" || job.status === "failed" || job.status === "cancelled";
}

/** One line for the status area. */
export function describeJob(job: AudioJob): string {
  switch (job.status) {
    case "queued":
      return job.position ? `Queued: ${job.position} ${job.position === 1 ? "clip" : "clips"} ahead.` : "Queued: starting next.";
    case "loading":
      return "Loading the model. The first time takes about a minute.";
    case "generating":
      return `Generating: ${Math.floor(job.progress * 100)}%.`;
    case "completed":
      return "Done.";
    case "failed":
      return job.error ?? "Prototype audio failed. Try again.";
    case "cancelled":
      return "Cancelled.";
  }
}

/** Keeps the newest state: events can arrive out of order with a status poll. */
export function newerJob(current: AudioJob | null, incoming: AudioJob): AudioJob {
  if (!current || current.jobId !== incoming.jobId) return incoming;
  if (isFinished(current)) return current;
  return (incoming.version ?? 0) >= (current.version ?? 0) ? incoming : current;
}
