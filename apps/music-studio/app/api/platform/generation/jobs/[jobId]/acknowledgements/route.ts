import { GenerationStatusAcknowledgementSchema, PlatformErrorSchema } from "@synaptix/platform-contracts";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function platformBaseUrl(): string {
  const value = process.env.SYNAPTIX_PLATFORM_API_URL;
  if (!value) throw new Error("SYNAPTIX_PLATFORM_API_URL is not configured.");
  return value.replace(/\/$/, "");
}

export async function POST(
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

  let input;
  try {
    input = GenerationStatusAcknowledgementSchema.parse(await request.json());
  } catch {
    return NextResponse.json(PlatformErrorSchema.parse({
      code: "invalid_acknowledgement", message: "The acknowledgement is invalid.", correlationId
    }), { status: 400 });
  }

  try {
    const response = await fetch(
      `${platformBaseUrl()}/api/v1/music/generation/jobs/${encodeURIComponent(jobId)}/acknowledgements`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": correlationId,
          ...(authorization ? { authorization } : {}),
          ...(cookie ? { cookie } : {})
        },
        body: JSON.stringify(input),
        cache: "no-store"
      }
    );
    if (!response.ok) {
      const body: unknown = await response.json();
      return NextResponse.json(PlatformErrorSchema.parse(body), { status: response.status });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Platform request failed.";
    return NextResponse.json(PlatformErrorSchema.parse({
      code: "platform_unavailable", message, correlationId, retryable: true
    }), { status: 502 });
  }
}
