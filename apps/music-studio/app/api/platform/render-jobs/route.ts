import { RenderManifestSchema } from "@synaptix/render-contracts";
import { NextRequest, NextResponse } from "next/server";

import { correlationId, renderWorkerJson, requireAuthentication } from "./_proxy";

export const runtime = "nodejs";

export function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams.toString();
  return renderWorkerJson(request, query ? `/render-jobs?${query}` : "/render-jobs");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const id = correlationId(request);
  const authError = requireAuthentication(request, id);
  if (authError) return authError;

  if (!request.headers.get("idempotency-key")) {
    return NextResponse.json(
      { code: "idempotency_key_required", message: "Idempotency-Key header is required.", correlationId: id },
      { status: 400 }
    );
  }

  let body: { manifest?: unknown; maxAttempts?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_json_body", message: "The request body is not valid JSON.", correlationId: id },
      { status: 400 }
    );
  }

  const parsedManifest = RenderManifestSchema.safeParse(body.manifest);
  if (!parsedManifest.success) {
    return NextResponse.json(
      { code: "invalid_render_manifest", message: parsedManifest.error.message, correlationId: id },
      { status: 400 }
    );
  }

  return renderWorkerJson(request, "/render-jobs", {
    method: "POST",
    body: JSON.stringify({ manifest: parsedManifest.data, maxAttempts: body.maxAttempts })
  });
}
