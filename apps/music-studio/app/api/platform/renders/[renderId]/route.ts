import { NextRequest, NextResponse } from "next/server";

import { renderWorkerJson } from "../../render-jobs/_proxy";

export const runtime = "nodejs";

/** The signed-in player's render job for a render id (frozen plug-in references name renders). */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ renderId: string }> }
): Promise<NextResponse> {
  const { renderId } = await context.params;
  return renderWorkerJson(request, `/renders/${encodeURIComponent(renderId)}`);
}
