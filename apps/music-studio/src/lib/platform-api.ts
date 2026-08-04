import {
  GenerationJobRequestSchema,
  GenerationJobSchema,
  PlatformErrorSchema,
  TerminalGenerationJobStatuses,
  type GenerationJob,
  type GenerationJobRequest,
  type PlatformError
} from "@synaptix/platform-contracts";

export class PlatformApiError extends Error {
  constructor(readonly detail: PlatformError, readonly status: number) {
    super(detail.message);
    this.name = "PlatformApiError";
  }
}

async function parseResponse(response: Response): Promise<GenerationJob> {
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new PlatformApiError(PlatformErrorSchema.parse(body), response.status);
  }
  return GenerationJobSchema.parse(body);
}

export async function submitGenerationJob(
  input: GenerationJobRequest,
  signal?: AbortSignal
): Promise<GenerationJob> {
  const request = GenerationJobRequestSchema.parse(input);
  const response = await fetch("/api/platform/generation/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": request.correlationId,
      "idempotency-key": request.idempotencyKey
    },
    credentials: "include",
    body: JSON.stringify(request),
    signal
  });
  return parseResponse(response);
}

export async function getGenerationJob(
  jobId: string,
  signal?: AbortSignal
): Promise<GenerationJob> {
  const response = await fetch(`/api/platform/generation/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal
  });
  return parseResponse(response);
}

export interface PollGenerationJobOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  onUpdate?: (job: GenerationJob) => void;
}

export async function pollGenerationJob(
  jobId: string,
  options: PollGenerationJobOptions = {}
): Promise<GenerationJob> {
  const intervalMs = Math.max(500, options.intervalMs ?? 1500);
  const timeoutMs = Math.max(intervalMs, options.timeoutMs ?? 120_000);
  const startedAt = Date.now();

  while (true) {
    options.signal?.throwIfAborted();
    const job = await getGenerationJob(jobId, options.signal);
    options.onUpdate?.(job);

    if (TerminalGenerationJobStatuses.has(job.status as never)) {
      return job;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new PlatformApiError(
        {
          code: "generation_status_timeout",
          message: "Generation status polling timed out.",
          correlationId: job.correlationId,
          retryable: true
        },
        408
      );
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      options.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });
  }
}
