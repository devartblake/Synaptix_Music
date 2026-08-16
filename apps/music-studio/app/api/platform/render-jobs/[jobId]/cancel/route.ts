import { NextRequest, NextResponse } from "next/server";

import { renderWorkerJson } from "../../_proxy";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  const { jobId } = await context.params;
  return renderWorkerJson(request, `/render-jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}
