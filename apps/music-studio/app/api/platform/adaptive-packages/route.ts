import { NextRequest, NextResponse } from "next/server";

import { PublishAdaptivePackageRequestSchema } from "@synaptix/platform-contracts/adaptive-packages";

import { platformJson } from "./_proxy";

export const runtime = "nodejs";

export function GET(request: NextRequest): Promise<NextResponse> {
  return platformJson(request, "/api/v1/music/adaptive-packages");
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
