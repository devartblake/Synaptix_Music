import { NextRequest, NextResponse } from "next/server";

import { correlationId, renderWorkerBaseUrl, requireAuthentication } from "../../../../_proxy";

export const runtime = "nodejs";

function allowedDownloadUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/**
 * Streams a render artifact's bytes through this origin so the browser can store it for
 * offline listening. The object store's signed URL is resolved and fetched server-side, so the
 * bucket needs no browser CORS policy and the signed URL never reaches the client.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string; artifactId: string }> }
): Promise<Response> {
  const id = correlationId(request);
  const authError = requireAuthentication(request, id);
  if (authError) return authError;
  const { jobId, artifactId } = await context.params;

  try {
    const link = await fetch(
      `${renderWorkerBaseUrl()}/render-jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}/download-url`,
      { headers: { "x-correlation-id": id }, cache: "no-store" }
    );
    if (!link.ok) {
      return NextResponse.json({ code: "artifact_unavailable", message: "The render file isn't available.", correlationId: id }, { status: link.status });
    }
    const body = (await link.json()) as { artifactId?: unknown; downloadUrl?: unknown };
    const url = allowedDownloadUrl(body.downloadUrl);
    if (body.artifactId !== artifactId || !url) {
      return NextResponse.json({ code: "invalid_download_link", message: "The render link was invalid.", correlationId: id }, { status: 502 });
    }

    const file = await fetch(url, { cache: "no-store" });
    if (!file.ok || !file.body) {
      return NextResponse.json({ code: "artifact_unavailable", message: "The render file couldn't be fetched.", correlationId: id }, { status: 502 });
    }
    const headers = new Headers({
      "content-type": file.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, no-store",
      "x-correlation-id": id
    });
    const length = file.headers.get("content-length");
    if (length) headers.set("content-length", length);
    return new Response(file.body, { status: 200, headers });
  } catch (error) {
    return NextResponse.json({
      code: "render_worker_unavailable",
      message: error instanceof Error ? error.message : "Render worker request failed.",
      correlationId: id,
      retryable: true
    }, { status: 502 });
  }
}
