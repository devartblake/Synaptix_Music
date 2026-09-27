import { NextRequest, NextResponse } from "next/server";
import { platformAuthorization } from "../../../../lib/platform/platform-session";
import { createRenderOwnerResolver } from "../../../../lib/platform/render-owner";

// Unlike other /api/platform/* routes, this proxies directly to the
// render-worker service rather than through SYNAPTIX_PLATFORM_API_URL (the
// .NET backend). That's a deliberate, temporary architecture decision: the
// render-worker HTTP API is a new, self-contained resource that doesn't yet
// need the .NET backend's multi-tenant authorization model. The BFF still
// requires end-user authentication before proxying anything, and scopes every request to
// the signed-in player (the worker filters jobs by the x-synaptix-owner header).
export function renderWorkerBaseUrl(): string {
  const value = process.env.RENDER_WORKER_API_URL;
  if (!value) throw new Error("RENDER_WORKER_API_URL is not configured.");
  return value.replace(/\/$/, "");
}

export function correlationId(request: NextRequest): string {
  return request.headers.get("x-correlation-id") ?? crypto.randomUUID();
}

export function requireAuthentication(request: NextRequest, id: string): NextResponse | null {
  if (platformAuthorization(request)) return null;
  return NextResponse.json(
    { code: "authentication_required", message: "Authentication is required.", correlationId: id },
    { status: 401 }
  );
}

const resolveRenderOwner = createRenderOwnerResolver({
  platformBaseUrl: () => {
    const value = process.env.SYNAPTIX_PLATFORM_API_URL;
    if (!value) throw new Error("SYNAPTIX_PLATFORM_API_URL is not configured.");
    return value.replace(/\/$/, "");
  }
});

/** The signed-in player's id for the worker's owner header, or the response to send instead. */
export async function renderOwnerHeaders(
  request: NextRequest,
  id: string
): Promise<{ "x-synaptix-owner": string } | NextResponse> {
  const authorization = platformAuthorization(request);
  const authError = requireAuthentication(request, id);
  if (authError || !authorization) return authError!;
  let result: Awaited<ReturnType<typeof resolveRenderOwner>>;
  try {
    result = await resolveRenderOwner(authorization, id);
  } catch (error) {
    result = { status: "unavailable", message: error instanceof Error ? error.message : "Platform request failed." };
  }
  if (result.status === "ok") return { "x-synaptix-owner": result.owner };
  if (result.status === "unauthenticated") {
    return NextResponse.json(
      { code: "authentication_required", message: "Authentication is required.", correlationId: id },
      { status: 401 }
    );
  }
  return NextResponse.json(
    { code: "platform_unavailable", message: result.message, correlationId: id, retryable: true },
    { status: 502 }
  );
}

export async function renderWorkerJson(
  request: NextRequest,
  path: string,
  init: RequestInit = {}
): Promise<NextResponse> {
  const id = correlationId(request);
  const owner = await renderOwnerHeaders(request, id);
  if (owner instanceof NextResponse) return owner;

  const idempotencyKey = request.headers.get("idempotency-key");
  try {
    const response = await fetch(`${renderWorkerBaseUrl()}${path}`, {
      ...init,
      headers: {
        "x-correlation-id": id,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...init.headers,
        ...owner
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
