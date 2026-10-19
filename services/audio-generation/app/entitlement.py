"""The server-side lock on AI audio (Synaptix_Music publication-rules-v1, decision L4).

The service only answers callers the platform says are entitled. The platform signs a short-lived
grant (``v1.<account>.<expires>.<hmac>``, HMAC-SHA256 over the first three parts) with a secret
this service shares; the studio's BFF fetches one per request and forwards it. Hiding a button is
never the only barrier: without a valid grant every ``/audio`` route answers 403.

Fails closed: with no ``SYNAPTIX_AUDIO_GRANT_SECRET`` nothing is allowed. Local demos turn the
lock off explicitly with ``SYNAPTIX_AUDIO_LOCK=off``.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Annotated

from fastapi import Header, HTTPException

GRANT_HEADER = "X-Synaptix-Audio-Grant"


def lock_disabled() -> bool:
    return os.environ.get("SYNAPTIX_AUDIO_LOCK", "").strip().lower() == "off"


def sign_grant(account: str, expires: int, secret: str) -> str:
    """A grant for ``account`` valid until ``expires`` (Unix seconds).

    This is the platform's side of the contract; the service only verifies.
    """
    payload = f"v1.{account}.{expires}"
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def verify_grant(token: str, secret: str, now: float | None = None) -> str | None:
    """The account a valid, unexpired grant names, or None."""
    parts = token.split(".")
    if len(parts) != 4 or parts[0] != "v1" or not parts[1] or not parts[2].isdigit():
        return None
    expected = sign_grant(parts[1], int(parts[2]), secret).rsplit(".", 1)[1]
    if not hmac.compare_digest(expected, parts[3]):
        return None
    if int(parts[2]) < (time.time() if now is None else now):
        return None
    return parts[1]


def require_grant(
    grant: Annotated[str | None, Header(alias=GRANT_HEADER)] = None,
) -> str | None:
    """FastAPI dependency: the entitled account, or 403. None when the lock is off (local demos)."""
    if lock_disabled():
        return None
    secret = os.environ.get("SYNAPTIX_AUDIO_GRANT_SECRET", "").strip()
    account = verify_grant(grant, secret) if secret and grant else None
    if account is None:
        raise HTTPException(
            status_code=403,
            detail=(
                "AI audio isn't available for this account. "
                "It is locked until the platform enables it."
            ),
        )
    return account
