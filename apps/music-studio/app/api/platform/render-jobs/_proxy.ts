import { NextRequest, NextResponse } from "next/server";

// Unlike other /api/platform/* routes, this proxies directly to the
// render-worker service rather than through SYNAPTIX_PLATFORM_API_URL (the
// .NET backend). That's a deliberate, temporary architecture decision: the
// render-worker HTTP API is a new, self-contained resource that doesn't yet
// need the .NET backend's multi-tenant authorization model. The BFF still
// requires end-user authentication before proxying anything.
export function renderWorkerBaseUrl(): string {
  const value = process.env.RENDER_WORKER_API_URL;
  if (!value) throw new Error("RENDER_WORKER_API_URL is not configured.");
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

export async function renderWorkerJson(
  request: NextRequest,
  path: string,
  init: RequestInit = {}
): Promise<NextResponse> {
  const id = correlationId(request);
  const authError = requireAuthentication(request, id);
  if (authError) return authError;

  const idempotencyKey = request.headers.get("idempotency-key");
  try {
    const response = await fetch(`${renderWorkerBaseUrl()}${path}`, {
      ...init,
      headers: {
        "x-correlation-id": id,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
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
        code: "render_worker_unavailable",
        message: error instanceof Error ? error.message : "Render worker request failed.",
        correlationId: id,
        retryable: true
      },
      { status: 502 }
    );
  }
}
