import { platformAuthorization } from "../platform/platform-session.ts";

/*
 * The prototype-audio service is locked (publication-rules-v1, decision L4): it answers only
 * requests carrying a grant the platform signed for an entitled account. The studio's server
 * fetches one with the caller's session and forwards it, so hiding the panel is never the only
 * barrier. SYNAPTIX_AUDIO_LOCK=off turns the lock off for local demos, matching the service's own
 * switch.
 */

export type GrantRequest = Parameters<typeof platformAuthorization>[0];
export type Grant = { headers: Record<string, string> } | { status: 403 | 502; body: { message: string } };

export const GRANT_HEADER = "x-synaptix-audio-grant";
export const LOCKED = {
  message: "AI audio isn't available for this account. It is locked until the platform enables it."
};
const GRANT_UNAVAILABLE = { message: "SynaptixPlay couldn't confirm AI audio access. Try again shortly." };

function lockDisabled(): boolean {
  return process.env.SYNAPTIX_AUDIO_LOCK?.trim().toLowerCase() === "off";
}

/**
 * The grant header for this caller. Signed-out callers and accounts the platform refuses get 403;
 * a platform that can't be reached gets 502. Either way the service isn't called.
 */
export async function audioGrant(request: GrantRequest): Promise<Grant> {
  if (lockDisabled()) return { headers: {} };
  const authorization = platformAuthorization(request);
  const platform = process.env.SYNAPTIX_PLATFORM_API_URL?.trim().replace(/\/$/, "");
  if (!authorization || !platform) return { status: 403, body: LOCKED };
  try {
    const response = await fetch(`${platform}/api/v1/music/ai-audio/grants`, {
      method: "POST",
      headers: { authorization },
      cache: "no-store",
      signal: AbortSignal.timeout(5000)
    });
    if (response.status === 401 || response.status === 403) return { status: 403, body: LOCKED };
    const body = (await response.json().catch(() => ({}))) as { token?: unknown };
    if (!response.ok || typeof body.token !== "string") return { status: 502, body: GRANT_UNAVAILABLE };
    return { headers: { [GRANT_HEADER]: body.token } };
  } catch {
    return { status: 502, body: GRANT_UNAVAILABLE };
  }
}
