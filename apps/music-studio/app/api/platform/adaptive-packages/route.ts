import { NextRequest, NextResponse } from "next/server";

import { PublishAdaptivePackageRequestSchema } from "@synaptix/platform-contracts/adaptive-packages";

import { platformJson } from "./_proxy";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller's packages; `?projectId=` narrows them to one project's (the platform filters). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (projectId === null) return platformJson(request, "/api/v1/music/adaptive-packages");
  if (!UUID.test(projectId)) {
    return NextResponse.json(
      { code: "invalid_project_id", message: "projectId must be a UUID." },
      { status: 400 }
    );
  }
  return platformJson(request, `/api/v1/music/adaptive-packages?projectId=${encodeURIComponent(projectId)}`);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json();
  const parsed = PublishAdaptivePackageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "invalid_adaptive_package", message: parsed.error.message },
      { status: 400 }
    );
  }
  return platformJson(request, "/api/v1/music/adaptive-packages", {
    method: "POST",
    body: JSON.stringify(parsed.data)
  });
}
