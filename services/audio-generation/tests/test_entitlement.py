"""The server-side lock on AI audio (publication-rules-v1, decision L4).

The service answers only callers the platform signed a grant for, so hiding the studio's button is
never the only barrier; and with no secret configured it refuses everyone (fails closed).
"""

import pytest
from fastapi.testclient import TestClient

from app.entitlement import GRANT_HEADER, sign_grant, verify_grant
from app.main import app, default_generator
from tests.test_api import FakeGenerator

SECRET = "test-grant-secret"
ACCOUNT = "11111111-1111-4111-8111-111111111111"
BODY = {"prompt": "calm synth loop", "durationSeconds": 1}


@pytest.fixture
def locked(monkeypatch):
    monkeypatch.delenv("SYNAPTIX_AUDIO_LOCK", raising=False)
    monkeypatch.setenv("SYNAPTIX_AUDIO_GRANT_SECRET", SECRET)
    app.dependency_overrides[default_generator] = lambda: FakeGenerator()
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_a_valid_grant_names_its_account_until_it_expires() -> None:
    token = sign_grant(ACCOUNT, 2_000, SECRET)
    assert verify_grant(token, SECRET, now=1_999) == ACCOUNT
    assert verify_grant(token, SECRET, now=2_001) is None
    assert verify_grant(token, "another-secret", now=1_999) is None
    tampered = token.replace(ACCOUNT, "22222222-2222-4222-8222-222222222222")
    assert verify_grant(tampered, SECRET, now=1_999) is None
    assert verify_grant("not-a-grant", SECRET, now=0) is None


def test_audio_routes_refuse_callers_without_a_grant(locked) -> None:
    assert locked.post("/audio/generations", json=BODY).status_code == 403
    assert locked.post("/audio/jobs", json=BODY).status_code == 403
    assert locked.get("/audio/jobs/" + "0" * 32).status_code == 403
    expired = sign_grant(ACCOUNT, 1, SECRET)
    assert locked.post("/audio/jobs", json=BODY, headers={GRANT_HEADER: expired}).status_code == 403
    # Health checks stay open so the deployment can be monitored.
    assert locked.get("/healthz").status_code == 200


def test_an_entitled_caller_gets_audio(locked) -> None:
    grant = sign_grant(ACCOUNT, 4_102_444_800, SECRET)  # 2100-01-01
    response = locked.post("/audio/generations", json=BODY, headers={GRANT_HEADER: grant})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"


def test_with_no_secret_configured_nobody_gets_in(monkeypatch, locked) -> None:
    monkeypatch.delenv("SYNAPTIX_AUDIO_GRANT_SECRET")
    grant = sign_grant(ACCOUNT, 4_102_444_800, SECRET)
    assert (
        locked.post("/audio/generations", json=BODY, headers={GRANT_HEADER: grant}).status_code
        == 403
    )
