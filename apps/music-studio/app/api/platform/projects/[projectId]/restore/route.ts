import { NextRequest, NextResponse } from "next/server";

import { setProjectArchived } from "../../_lifecycle";

export const runtime = "nodejs";

export function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }): Promise<NextResponse> {
  return setProjectArchived(request, context, "restore");
}
