import { GenerationStatusReplaySchema, PlatformErrorSchema } from "@synaptix/platform-contracts";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function platformBaseUrl(): string {
  const value = process.env.SYNAPTIX_PLATFORM_API_URL;
  if (!value) throw new Error("SYNAPTIX_PLATFORM_API_URL is not configured.");
  return value.replace(/\/$/, "");
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
    return NextResponse.json(PlatformErrorSchema.parse({
      code: "authentication_required", message: "Authentication is required.", correlationId
    }), { status: 401 });
  }

  try {
    const response = await fetch(
      `${platformBaseUrl()}/api/v1/music/generation/jobs/${encodeURIComponent(jobId)}/events?${request.nextUrl.searchParams}`,
      {
        headers: {
          "x-correlation-id": correlationId,
          ...(authorization ? { authorization } : {}),
          ...(cookie ? { cookie } : {})
        },
        cache: "no-store"
      }
    );
    const body: unknown = await response.json();
    if (!response.ok) return NextResponse.json(PlatformErrorSchema.parse(body), { status: response.status });
    return NextResponse.json(GenerationStatusReplaySchema.parse(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Platform request failed.";
    return NextResponse.json(PlatformErrorSchema.parse({
      code: "platform_unavailable", message, correlationId, retryable: true
    }), { status: 502 });
  }
}
