import { GenerationJobSchema, PlatformErrorSchema } from "@synaptix/platform-contracts";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function platformBaseUrl(): string {
  const value = process.env.SYNAPTIX_PLATFORM_API_URL;
  if (!value) {
    throw new Error("SYNAPTIX_PLATFORM_API_URL is not configured.");
  }
  return value.replace(/\/$/, "");
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  retryable = false
): NextResponse {
  return NextResponse.json(
    PlatformErrorSchema.parse({ code, message, correlationId, retryable }),
    { status }
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  const { jobId } = await context.params;

  if (!authorization && !cookie) {
    return errorResponse(401, "authentication_required", "Authentication is required.", correlationId);
  }
  if (!jobId) {
    return errorResponse(400, "invalid_job_id", "A generation job ID is required.", correlationId);
  }

  try {
    const response = await fetch(
      `${platformBaseUrl()}/api/v1/music/generation/jobs/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: {
          "x-correlation-id": correlationId,
          ...(authorization ? { authorization } : {}),
          ...(cookie ? { cookie } : {})
        },
        cache: "no-store"
      }
    );

    const body: unknown = await response.json();
    if (!response.ok) {
      return NextResponse.json(PlatformErrorSchema.parse(body), { status: response.status });
    }
    return NextResponse.json(GenerationJobSchema.parse(body), { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Platform request failed.";
    return errorResponse(502, "platform_unavailable", message, correlationId, true);
  }
}
