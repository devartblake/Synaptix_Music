import { NextRequest, NextResponse } from "next/server";

import { platformJson } from "../_proxy";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ packageId: string }> }
): Promise<NextResponse> {
  const { packageId } = await context.params;
  return platformJson(
    request,
    `/api/v1/music/adaptive-packages/${encodeURIComponent(packageId)}`
  );
}
