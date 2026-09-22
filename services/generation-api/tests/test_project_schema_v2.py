import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.models.project import MusicProject
from app.models.project_v2 import MusicProjectV2, migrate_project_v1_to_v2

ROOT = Path(__file__).resolve().parents[3]
V1_FIXTURE = ROOT / "schemas" / "project" / "fixtures" / "minimal-v1.json"
V2_FIXTURE = ROOT / "schemas" / "project" / "fixtures" / "minimal-v2.json"


def load(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_canonical_v2_fixture_validates() -> None:
    project = MusicProjectV2.model_validate(load(V2_FIXTURE))
    device = project.tracks[0].devices[0]
    assert project.schemaVersion == 2
    assert device.plugin.runtimeKind == "builtin"
    assert device.plugin.pluginId == device.deviceType


def test_v1_to_v2_migration_is_deterministic() -> None:
    v1 = MusicProject.model_validate(load(V1_FIXTURE))
    first = migrate_project_v1_to_v2(v1)
    second = migrate_project_v1_to_v2(v1)
    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert first.model_dump(mode="json") == load(V2_FIXTURE)
    assert v1.schemaVersion == 1


def test_versions_fail_closed_across_models() -> None:
    with pytest.raises(ValidationError):
        MusicProject.model_validate(load(V2_FIXTURE))
    with pytest.raises(ValidationError):
        MusicProjectV2.model_validate(load(V1_FIXTURE))


def test_v2_rejects_unknown_fields_and_bad_checksums() -> None:
    payload = load(V2_FIXTURE)
    payload["tracks"][0]["devices"][0]["plugin"]["unexpected"] = True  # type: ignore[index]
    with pytest.raises(ValidationError):
        MusicProjectV2.model_validate(payload)

    payload = load(V2_FIXTURE)
    payload["tracks"][0]["devices"][0]["plugin"]["moduleChecksumSha256"] = "bad"  # type: ignore[index]
    with pytest.raises(ValidationError):
        MusicProjectV2.model_validate(payload)
