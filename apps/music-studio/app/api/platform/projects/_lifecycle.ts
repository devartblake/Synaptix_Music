import { NextRequest, NextResponse } from "next/server";
import { platformAuthorization } from "../../../../lib/platform/platform-session";

function platformBaseUrl(): string {
  const value = process.env.SYNAPTIX_PLATFORM_API_URL;
  if (!value) throw new Error("SYNAPTIX_PLATFORM_API_URL is not configured.");
  return value.replace(/\/$/, "");
}

/** Archive or restore one of the signed-in player's cloud projects (the platform owns the rule). */
export async function setProjectArchived(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
  action: "archive" | "restore"
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = platformAuthorization(request);
  if (!authorization) {
    return NextResponse.json(
      { code: "authentication_required", message: "Authentication is required.", correlationId },
      { status: 401 }
    );
  }
  const { projectId } = await context.params;
  try {
    const response = await fetch(
      `${platformBaseUrl()}/api/v1/music/projects/${encodeURIComponent(projectId)}/${action}`,
      { method: "POST", headers: { authorization, "x-correlation-id": correlationId }, cache: "no-store" }
    );
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    const text = await response.text();
    return NextResponse.json(text ? JSON.parse(text) : { correlationId }, { status: response.status });
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
