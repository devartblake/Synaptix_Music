import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.models.project import MusicProject

FIXTURE_PATH = (
    Path(__file__).resolve().parents[3] / "schemas" / "project" / "fixtures" / "minimal-v1.json"
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


def test_project_key_is_optional_and_strictly_shaped() -> None:
    # The key travels with the project: a pitch class 0-11 and one of the generator's seven modes.
    fixture = load_fixture()
    assert MusicProject.model_validate(fixture).key is None
    keyed = {**fixture, "key": {"tonic": 9, "mode": "harmonic minor"}}
    assert MusicProject.model_validate(keyed).key.tonic == 9
    for bad in ({"tonic": 12, "mode": "minor"}, {"tonic": 0, "mode": "blues"}, {"tonic": 0}):
        with pytest.raises(ValidationError):
            MusicProject.model_validate({**fixture, "key": bad})
    schema = json.loads((FIXTURE_PATH.parents[1] / "v1.json").read_text(encoding="utf-8"))
    assert schema["properties"]["key"] == {"$ref": "#/$defs/musicalKey"}
    assert schema["$defs"]["musicalKey"]["properties"]["tonic"]["maximum"] == 11


def test_note_label_is_optional_and_bounded() -> None:
    # Renamable note labels: absent unless set, 1-32 characters.
    fixture = load_fixture()
    project = MusicProject.model_validate(fixture)
    assert project.tracks[0].clips[0].notes[0].label is None  # type: ignore[union-attr]
    dumped = project.model_dump(mode="json", exclude_unset=True)
    assert "label" not in dumped["tracks"][0]["clips"][0]["notes"][0]
    cases = (("Kick", True), ("x" * 32, True), ("", False), ("x" * 33, False), (5, False))
    for label, valid in cases:
        payload = load_fixture()
        payload["tracks"][0]["clips"][0]["notes"][0]["label"] = label  # type: ignore[index]
        if valid:
            labelled = MusicProject.model_validate(payload)
            assert labelled.tracks[0].clips[0].notes[0].label == label  # type: ignore[union-attr]
        else:
            with pytest.raises(ValidationError):
                MusicProject.model_validate(payload)
    schema = json.loads((FIXTURE_PATH.parents[1] / "v1.json").read_text(encoding="utf-8"))
    assert schema["$defs"]["midiNote"]["properties"]["label"] == {
        "type": "string",
        "minLength": 1,
        "maxLength": 32,
    }


def test_generation_fingerprint_is_optional_and_strictly_shaped() -> None:
    # The studio fingerprints the generated arrangement to tell generated music from edited.
    fixture = load_fixture()
    base = {"generatorId": "composer", "generatorVersion": "1.0.0", "seed": 1}
    base["createdAt"] = "2026-10-10T00:00:00Z"
    project = MusicProject.model_validate({**fixture, "generationMetadata": base})
    assert project.generationMetadata is not None
    assert project.generationMetadata.arrangementFingerprint is None
    good = {**base, "arrangementFingerprint": "fnv1a64:0123456789abcdef"}
    validated = MusicProject.model_validate({**fixture, "generationMetadata": good})
    assert validated.generationMetadata.arrangementFingerprint == "fnv1a64:0123456789abcdef"  # type: ignore[union-attr]
    for bad in ("0123456789abcdef", "fnv1a64:XYZ", "fnv1a64:0123"):
        with pytest.raises(ValidationError):
            MusicProject.model_validate(
                {**fixture, "generationMetadata": {**base, "arrangementFingerprint": bad}}
            )
    schema = json.loads((FIXTURE_PATH.parents[1] / "v1.json").read_text(encoding="utf-8"))
    fingerprint = schema["$defs"]["generationMetadata"]["properties"]["arrangementFingerprint"]
    assert fingerprint == {"type": "string", "pattern": "^fnv1a64:[0-9a-f]{16}$"}
