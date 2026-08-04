import {
  GenerationJobListSchema,
  GenerationJobRequestSchema,
  GenerationJobSchema,
  PlatformErrorSchema
} from "@synaptix/platform-contracts";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function platformBaseUrl(): string {
  const value = process.env.SYNAPTIX_PLATFORM_API_URL;
  if (!value) throw new Error("SYNAPTIX_PLATFORM_API_URL is not configured.");
  return value.replace(/\/$/, "");
}

function authHeaders(request: NextRequest): Record<string, string> {
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  return {
    ...(authorization ? { authorization } : {}),
    ...(cookie ? { cookie } : {})
  };
}

function errorResponse(status: number, code: string, message: string, correlationId: string, retryable = false): NextResponse {
  return NextResponse.json(
    PlatformErrorSchema.parse({ code, message, correlationId, retryable }),
    { status }
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const headers = authHeaders(request);
  if (!headers.authorization && !headers.cookie) {
    return errorResponse(401, "authentication_required", "Authentication is required.", correlationId);
  }

  try {
    const response = await fetch(
      `${platformBaseUrl()}/api/v1/music/generation/jobs?${request.nextUrl.searchParams}`,
      { headers: { "x-correlation-id": correlationId, ...headers }, cache: "no-store" }
    );
    const body: unknown = await response.json();
    if (!response.ok) return NextResponse.json(PlatformErrorSchema.parse(body), { status: response.status });
    return NextResponse.json(GenerationJobListSchema.parse(body), { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Platform request failed.";
    return errorResponse(502, "platform_unavailable", message, correlationId, true);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const headers = authHeaders(request);
  if (!headers.authorization && !headers.cookie) {
    return errorResponse(401, "authentication_required", "Authentication is required.", correlationId);
  }

  let input;
  try {
    input = GenerationJobRequestSchema.parse(await request.json());
  } catch {
    return errorResponse(400, "invalid_generation_request", "The generation request is invalid.", correlationId);
  }

  try {
    const response = await fetch(`${platformBaseUrl()}/api/v1/music/generation/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
        "idempotency-key": input.idempotencyKey,
        ...headers
      },
      body: JSON.stringify(input),
      cache: "no-store"
    });
    const body: unknown = await response.json();
    if (!response.ok) return NextResponse.json(PlatformErrorSchema.parse(body), { status: response.status });
    return NextResponse.json(GenerationJobSchema.parse(body), { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Platform request failed.";
    return errorResponse(502, "platform_unavailable", message, correlationId, true);
  }
}
