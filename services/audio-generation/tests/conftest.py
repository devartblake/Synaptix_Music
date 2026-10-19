import pytest


@pytest.fixture(autouse=True)
def audio_lock_off(monkeypatch):
    # The API tests exercise the routes themselves; test_entitlement.py turns the lock back on.
    monkeypatch.setenv("SYNAPTIX_AUDIO_LOCK", "off")
