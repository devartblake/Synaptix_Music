import { NextResponse } from "next/server";

import { callAudioService, isAudioJobId, relayJson } from "../../../../../../lib/audio-prototype/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live progress for a prototype-audio job: the service's server-sent event stream, passed
 * through unbuffered. It ends when the job finishes or the browser disconnects.
 */
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }): Promise<Response> {
  const { jobId } = await params;
  if (!isAudioJobId(jobId)) return NextResponse.json({ message: "This prototype audio job doesn't exist." }, { status: 404 });
  const response = await callAudioService(`/audio/jobs/${jobId}/events`, {
    headers: { accept: "text/event-stream" },
    signal: request.signal,
    // The stream itself is capped by the service; this only bounds a hung connection.
    timeoutMs: 1_900_000
  });
  if (response instanceof NextResponse) return response;
  if (!response.ok || !response.body) return relayJson(response);
  return new Response(response.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no"
    }
  });
}
