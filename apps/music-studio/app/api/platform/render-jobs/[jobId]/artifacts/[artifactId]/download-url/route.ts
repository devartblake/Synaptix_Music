import { NextRequest, NextResponse } from "next/server";

import { renderWorkerJson } from "../../../../_proxy";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string; artifactId: string }> }
): Promise<NextResponse> {
  const { jobId, artifactId } = await context.params;
  return renderWorkerJson(
    request,
    `/render-jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}/download-url`
  );
}
