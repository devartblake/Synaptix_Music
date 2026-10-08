import { tokenExpiresAt, type PlatformProfile } from "./platform-session.ts";

/**
 * The studio's own SynaptixPlay sign-in, separate from the game clients.
 *
 * Only the studio's server calls the platform's studio routes (`/api/v1/auth/studio/login` and
 * `/studio/refresh`), with the studio's service token (`SYNAPTIX_PLATFORM_SERVICE_TOKEN` here,
 * `ServiceTokens:MusicStudio` on the platform). The platform assigns the studio identity, so the
 * studio sends no product registration, and the session renews instead of ending with its
 * 8-minute access token.
 */

export interface RefreshedSession {
  accessToken: string;
  refreshToken: string;
  /** Seconds since epoch. */
  expiresAt: number;
  profile: PlatformProfile;
}

export type RefreshOutcome =
  | { kind: "refreshed"; session: RefreshedSession }
  /** The platform refused the refresh token (expired, revoked or reused): sign in again. */
  | { kind: "signed-out" }
  /** Refresh isn't possible right now; the current session runs until it expires. */
  | { kind: "unavailable"; status: number; message: string };

export interface RefreshOptions {
  baseUrl: string | null;
  serviceToken: string | null;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  nowSeconds?: () => number;
}

/** The studio's service token; without it the studio can't sign anyone in. */
export function studioServiceToken(env: Record<string, string | undefined> = process.env): string | null {
  return env.SYNAPTIX_PLATFORM_SERVICE_TOKEN?.trim() || null;
}

/**
 * The platform refused the studio itself (wrong service token) or hasn't turned studio sign-in
 * on. That is a configuration problem, never the player's credentials or session.
 */
export async function studioRefusal(response: Response): Promise<string | null> {
  if (response.status === 503) return "SynaptixPlay hasn't turned on Music Studio sign-in.";
  if (response.status !== 401) return null;
  const body = (await response.clone().json().catch(() => null)) as { error?: { code?: unknown } } | null;
  return body?.error?.code === "service_authentication_required"
    ? "SynaptixPlay didn't accept this studio's service token."
    : null;
}

export async function refreshPlatformSession(options: RefreshOptions): Promise<RefreshOutcome> {
  const { baseUrl, serviceToken, refreshToken } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.nowSeconds ?? (() => Date.now() / 1000);

  if (!baseUrl) return { kind: "unavailable", status: 503, message: "The SynaptixPlay platform isn't configured for this studio." };
  if (!serviceToken)
    return { kind: "unavailable", status: 503, message: "Session renewal isn't configured for this studio." };

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/v1/auth/studio/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-token": serviceToken },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store"
    });
  } catch {
    return { kind: "unavailable", status: 502, message: "SynaptixPlay couldn't be reached." };
  }

  const refusal = await studioRefusal(response);
  if (refusal) return { kind: "unavailable", status: 502, message: refusal };
  if (response.status === 401) return { kind: "signed-out" };
  if (!response.ok) return { kind: "unavailable", status: 502, message: `SynaptixPlay couldn't renew the session (error ${response.status}).` };

  const body = (await response.json().catch(() => null)) as {
    accessToken?: unknown;
    refreshToken?: unknown;
    expiresIn?: unknown;
    user?: { handle?: unknown; email?: unknown };
  } | null;
  if (
    typeof body?.accessToken !== "string" ||
    typeof body.refreshToken !== "string" ||
    typeof body.user?.handle !== "string" ||
    typeof body.user.email !== "string"
  )
    return { kind: "unavailable", status: 502, message: "SynaptixPlay returned an unexpected renewal response." };

  const expiresIn = typeof body.expiresIn === "number" ? body.expiresIn : 0;
  return {
    kind: "refreshed",
    session: {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      expiresAt: tokenExpiresAt(body.accessToken) ?? now() + expiresIn,
      profile: { handle: body.user.handle, email: body.user.email }
    }
  };
}
