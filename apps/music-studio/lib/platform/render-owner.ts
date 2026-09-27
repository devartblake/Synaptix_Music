import { createHash } from "node:crypto";

/**
 * Resolves which SynaptixPlay player a render-worker request acts for.
 *
 * The render worker trusts the owner id the studio's server sends, so the id must come from
 * the platform, never from the token's unverified claims: the studio asks the platform who the
 * bearer token belongs to (GET /api/v1/users/me). Answers are cached briefly per token so
 * polling a render doesn't call the platform every time.
 */

export type RenderOwnerResult =
  | { status: "ok"; owner: string }
  | { status: "unauthenticated" }
  | { status: "unavailable"; message: string };

const CACHE_TTL_MS = 60_000;
const CACHE_LIMIT = 500;

export interface RenderOwnerResolverOptions {
  platformBaseUrl(): string;
  fetch?: typeof fetch;
  now?: () => number;
}

export function createRenderOwnerResolver(options: RenderOwnerResolverOptions) {
  const cache = new Map<string, { owner: string; expiresAt: number }>();
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetch ?? fetch;

  return async function resolveRenderOwner(authorization: string, correlationId: string): Promise<RenderOwnerResult> {
    const key = createHash("sha256").update(authorization).digest("hex");
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return { status: "ok", owner: cached.owner };
    cache.delete(key);

    let response: Response;
    try {
      response = await fetchImpl(`${options.platformBaseUrl()}/api/v1/users/me`, {
        headers: { authorization, "x-correlation-id": correlationId },
        cache: "no-store"
      });
    } catch (error) {
      return { status: "unavailable", message: error instanceof Error ? error.message : "Platform request failed." };
    }
    if (response.status === 401 || response.status === 403) return { status: "unauthenticated" };
    if (!response.ok) return { status: "unavailable", message: `The platform answered ${response.status}.` };

    const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
    const owner = typeof body?.id === "string" ? body.id.trim() : "";
    if (!owner || owner.length > 200 || owner.includes(",")) {
      return { status: "unavailable", message: "The platform didn't identify the signed-in player." };
    }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, { owner, expiresAt: now() + CACHE_TTL_MS });
    return { status: "ok", owner };
  };
}
