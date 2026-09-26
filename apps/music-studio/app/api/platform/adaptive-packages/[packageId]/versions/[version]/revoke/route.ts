import { NextRequest, NextResponse } from "next/server";

import { RevokeAdaptivePackageVersionRequestSchema } from "@synaptix/platform-contracts/adaptive-packages";

import { platformJson } from "../../../../_proxy";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ packageId: string; version: string }> }
): Promise<NextResponse> {
  const { packageId, version } = await context.params;
  const body: unknown = await request.json();
  const parsed = RevokeAdaptivePackageVersionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "invalid_revocation", message: parsed.error.message },
      { status: 400 }
    );
  }
  return platformJson(
    request,
    `/api/v1/music/adaptive-packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(version)}/revoke`,
    { method: "POST", body: JSON.stringify(parsed.data) }
  );
}
