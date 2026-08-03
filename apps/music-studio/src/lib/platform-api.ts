import {
  GenerationJobRequestSchema,
  GenerationJobSchema,
  PlatformErrorSchema,
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
