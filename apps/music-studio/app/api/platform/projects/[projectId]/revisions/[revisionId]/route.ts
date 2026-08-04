import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function platformBaseUrl(): string {
  const value = process.env.SYNAPTIX_PLATFORM_API_URL;
  if (!value) throw new Error("SYNAPTIX_PLATFORM_API_URL is not configured.");
  return value.replace(/\/$/, "");
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; revisionId: string }> }
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  const idempotencyKey = request.headers.get("idempotency-key");
  const expectedRevisionId = request.headers.get("if-match");
  const { projectId, revisionId } = await context.params;

  if (!authorization && !cookie) {
    return NextResponse.json(
      { code: "authentication_required", message: "Authentication is required.", correlationId },
      { status: 401 }
    );
  }
  if (!idempotencyKey) {
    return NextResponse.json(
      { code: "idempotency_key_required", message: "Idempotency-Key is required.", correlationId },
      { status: 400 }
    );
  }

  try {
    const body = await request.text();
    const response = await fetch(
      `${platformBaseUrl()}/api/v1/music/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": correlationId,
          "idempotency-key": idempotencyKey,
          ...(expectedRevisionId ? { "if-match": expectedRevisionId } : {}),
          ...(authorization ? { authorization } : {}),
          ...(cookie ? { cookie } : {})
        },
        body,
        cache: "no-store"
      }
    );
    const responseBody: unknown = await response.json();
    return NextResponse.json(responseBody, { status: response.status });
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
