import json
from pathlib import Path

from pydantic import ValidationError
import pytest

from app.models.project import MusicProject


FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "schemas"
    / "project"
    / "fixtures"
    / "minimal-v1.json"
)


def load_fixture() -> dict[str, object]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_canonical_fixture_validates() -> None:
    project = MusicProject.model_validate(load_fixture())

    assert project.schemaVersion == 1
    assert project.transport.ticksPerQuarterNote == 960
    assert project.tracks[0].clips[0].kind == "midi"


def test_unknown_fields_are_rejected() -> None:
    payload = load_fixture()
    payload["unexpected"] = True

    with pytest.raises(ValidationError):
        MusicProject.model_validate(payload)


def test_invalid_midi_pitch_is_rejected() -> None:
    payload = load_fixture()
    payload["tracks"][0]["clips"][0]["notes"][0]["pitch"] = 128  # type: ignore[index]

    with pytest.raises(ValidationError):
        MusicProject.model_validate(payload)
