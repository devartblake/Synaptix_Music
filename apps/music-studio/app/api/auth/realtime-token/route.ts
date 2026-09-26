import { NextRequest, NextResponse } from "next/server";

import { sessionToken } from "../../../../lib/platform/platform-session";

export const runtime = "nodejs";

/**
 * Hands the signed-in access token to the studio's own realtime (SignalR) client, which must
 * connect to the platform directly. Same-origin only: browsers don't let other sites read it.
 */
export function GET(request: NextRequest): NextResponse {
  const token = sessionToken(request);
  if (!token) {
    return NextResponse.json(
      { code: "authentication_required", message: "Sign in to SynaptixPlay to receive live updates." },
      { status: 401 }
    );
  }
  return NextResponse.json({ accessToken: token }, { headers: { "cache-control": "no-store" } });
}
