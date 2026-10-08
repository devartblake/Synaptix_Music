import { tokenExpiresAt, type PlatformProfile } from "./platform-session.ts";

/**
 * Renews the studio's SynaptixPlay session with the refresh token the studio's server keeps.
 *
 * The platform's `/auth/refresh` normally needs its KMS secure channel, which only the game
 * clients speak. It accepts plain JSON from this server when the request carries the studio's
 * service token (`ServiceTokens:MusicStudio` on the platform, `SYNAPTIX_PLATFORM_SERVICE_TOKEN`
 * here), so a studio session no longer ends with its 8-minute access token.
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

/** The product registration the studio signs in under; the platform requires one. */
export function productRegistrationId(env: Record<string, string | undefined> = process.env): string {
  return env.SYNAPTIX_PLATFORM_PRODUCT_REGISTRATION_ID?.trim() || "synaptix-play-general";
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
    response = await fetchImpl(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-token": serviceToken },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store"
    });
  } catch {
    return { kind: "unavailable", status: 502, message: "SynaptixPlay couldn't be reached." };
  }

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
