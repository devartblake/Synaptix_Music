import {
  GenerationJobListSchema,
  GenerationStatusAcknowledgementSchema,
  GenerationStatusReplaySchema,
  type GenerationJob,
  type GenerationStatusAcknowledgement,
  type GenerationStatusReplayEvent
} from "@synaptix/platform-contracts";

async function parseJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`Generation status request failed with ${response.status}.`);
  }
  return body;
}

export async function listGenerationJobs(
  activeOnly = true,
  limit = 25,
  signal?: AbortSignal
): Promise<GenerationJob[]> {
  const query = new URLSearchParams({
    activeOnly: String(activeOnly),
    limit: String(limit)
  });
  const response = await fetch(`/api/platform/generation/jobs?${query}`, {
    credentials: "include",
    cache: "no-store",
    signal
  });
  return GenerationJobListSchema.parse(await parseJson(response)).jobs;
}

export async function replayGenerationJobEvents(
  jobId: string,
  after?: string,
  signal?: AbortSignal
): Promise<GenerationStatusReplayEvent[]> {
  const query = new URLSearchParams();
  if (after) query.set("after", after);
  const response = await fetch(
    `/api/platform/generation/jobs/${encodeURIComponent(jobId)}/events?${query}`,
    { credentials: "include", cache: "no-store", signal }
  );
  return GenerationStatusReplaySchema.parse(await parseJson(response)).events;
}

export async function acknowledgeGenerationStatus(
  jobId: string,
  acknowledgement: GenerationStatusAcknowledgement,
  signal?: AbortSignal
): Promise<void> {
  const body = GenerationStatusAcknowledgementSchema.parse(acknowledgement);
  const response = await fetch(
    `/api/platform/generation/jobs/${encodeURIComponent(jobId)}/acknowledgements`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
      signal
    }
  );
  if (!response.ok) {
    throw new Error(`Generation acknowledgement failed with ${response.status}.`);
  }
}

export class ConcurrentGenerationStatusTracker {
  private readonly cursors = new Map<string, string>();

  cursorFor(jobId: string): string | undefined {
    return this.cursors.get(jobId);
  }

  record(jobId: string, cursor: string): void {
    this.cursors.set(jobId, cursor);
  }

  async reconcile(
    clientInstanceId: string,
    onEvent: (event: GenerationStatusReplayEvent) => Promise<void> | void,
    signal?: AbortSignal
  ): Promise<GenerationJob[]> {
    const jobs = await listGenerationJobs(true, 100, signal);
    for (const job of jobs) {
      const events = await replayGenerationJobEvents(job.jobId, this.cursorFor(job.jobId), signal);
      for (const event of events) {
        await onEvent(event);
        await acknowledgeGenerationStatus(job.jobId, {
          eventId: event.eventId,
          cursor: event.cursor,
          receivedAt: new Date().toISOString(),
          clientInstanceId
        }, signal);
        this.record(job.jobId, event.cursor);
      }
    }
    return jobs;
  }
}
