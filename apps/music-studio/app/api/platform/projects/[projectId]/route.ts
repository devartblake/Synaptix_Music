import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function platformBaseUrl(): string {
  const value = process.env.SYNAPTIX_PLATFORM_API_URL;
  if (!value) throw new Error("SYNAPTIX_PLATFORM_API_URL is not configured.");
  return value.replace(/\/$/, "");
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  const { projectId } = await context.params;

  if (!authorization && !cookie) {
    return NextResponse.json(
      { code: "authentication_required", message: "Authentication is required.", correlationId },
      { status: 401 }
    );
  }

  try {
    const response = await fetch(
      `${platformBaseUrl()}/api/v1/music/projects/${encodeURIComponent(projectId)}`,
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
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        code: "platform_unavailable",
        message: error instanceof Error ? error.message : "Platform request failed.",
        correlationId,
        retryable: true
      },
      { status: 502 }
    );
  }
}
