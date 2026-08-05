import { NextRequest, NextResponse } from "next/server";

export function platformBaseUrl(): string {
  const value = process.env.SYNAPTIX_PLATFORM_API_URL;
  if (!value) throw new Error("SYNAPTIX_PLATFORM_API_URL is not configured.");
  return value.replace(/\/$/, "");
}

export function correlationId(request: NextRequest): string {
  return request.headers.get("x-correlation-id") ?? crypto.randomUUID();
}

export function requireAuthentication(request: NextRequest, id: string): NextResponse | null {
  if (request.headers.get("authorization") || request.headers.get("cookie")) return null;
  return NextResponse.json(
    { code: "authentication_required", message: "Authentication is required.", correlationId: id },
    { status: 401 }
  );
}

export function forwardedHeaders(
  request: NextRequest,
  id: string,
  includeJson = false
): HeadersInit {
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  const idempotencyKey = request.headers.get("idempotency-key");
  return {
    "x-correlation-id": id,
    ...(includeJson ? { "content-type": "application/json" } : {}),
    ...(authorization ? { authorization } : {}),
    ...(cookie ? { cookie } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
  };
}

export async function platformJson(
  request: NextRequest,
  path: string,
  init: RequestInit = {}
): Promise<NextResponse> {
  const id = correlationId(request);
  const authError = requireAuthentication(request, id);
  if (authError) return authError;
  try {
    const response = await fetch(`${platformBaseUrl()}${path}`, {
      ...init,
      headers: {
        ...forwardedHeaders(request, id, init.body !== undefined),
        ...init.headers
      },
      cache: "no-store"
    });
    const text = await response.text();
    const body: unknown = text.length > 0 ? JSON.parse(text) : null;
    return body === null
      ? new NextResponse(null, { status: response.status })
      : NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        code: "platform_unavailable",
        message: error instanceof Error ? error.message : "Platform request failed.",
        correlationId: id,
        retryable: true
      },
      { status: 502 }
    );
  }
}
