import { NextRequest, NextResponse } from "next/server";
import { platformAuthorization } from "../../../../../../lib/platform/platform-session";

export const runtime = "nodejs";

/*
 * A project's cover image on the platform, so it follows the project to every device. The studio
 * prepares covers before upload (square, at most 1024 px, re-encoded); the platform accepts PNG,
 * JPEG or WebP up to 2 MB.
 */

type Context = { params: Promise<{ projectId: string }> };

function coverUrl(projectId: string): string {
  const base = process.env.SYNAPTIX_PLATFORM_API_URL;
  if (!base) throw new Error("SYNAPTIX_PLATFORM_API_URL is not configured.");
  return `${base.replace(/\/$/, "")}/api/v1/music/projects/${encodeURIComponent(projectId)}/cover`;
}

async function forward(request: NextRequest, context: Context, init: RequestInit): Promise<Response> {
  const authorization = platformAuthorization(request);
  if (!authorization) {
    return NextResponse.json({ code: "authentication_required", message: "Authentication is required." }, { status: 401 });
  }
  const { projectId } = await context.params;
  try {
    return await fetch(coverUrl(projectId), {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization },
      cache: "no-store"
    });
  } catch (error) {
    return NextResponse.json(
      { code: "platform_unavailable", message: error instanceof Error ? error.message : "Platform request failed.", retryable: true },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const ifNoneMatch = request.headers.get("if-none-match");
  const response = await forward(request, context, { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {} });
  if (!response.ok || response instanceof NextResponse) return response;
  const headers = new Headers({ "cache-control": "private, no-cache" });
  for (const name of ["content-type", "etag"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

export async function PUT(request: NextRequest, context: Context): Promise<Response> {
  return forward(request, context, {
    method: "PUT",
    headers: { "content-type": request.headers.get("content-type") ?? "application/octet-stream" },
    body: await request.arrayBuffer()
  });
}

export async function DELETE(request: NextRequest, context: Context): Promise<Response> {
  return forward(request, context, { method: "DELETE" });
}
