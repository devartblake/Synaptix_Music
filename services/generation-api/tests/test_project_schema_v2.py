import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
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
    dumped = first.model_dump(mode="json", exclude_unset=True)
    assert dumped == second.model_dump(mode="json", exclude_unset=True)
    assert dumped == load(V2_FIXTURE)
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


PLUGIN_FIXTURE = ROOT / "schemas" / "project" / "fixtures" / "plugin-v2.json"
JSON_SCHEMA = Draft202012Validator(load(ROOT / "schemas" / "project" / "v2.json"))


def mutate(path: Path, change: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    payload = load(path)
    change(payload)
    return payload


def plugin_device(payload: dict[str, Any]) -> dict[str, Any]:
    return payload["tracks"][0]["devices"][1]


def first_point(payload: dict[str, Any]) -> dict[str, Any]:
    return plugin_device(payload)["automation"][0]["points"][0]


@pytest.mark.parametrize("fixture", [V2_FIXTURE, PLUGIN_FIXTURE], ids=["minimal", "plugin"])
def test_fixtures_are_accepted_by_json_schema_and_pydantic(fixture: Path) -> None:
    payload = load(fixture)
    assert list(JSON_SCHEMA.iter_errors(payload)) == []
    project = MusicProjectV2.model_validate(payload)
    assert project.model_dump(mode="json", exclude_unset=True) == payload


REJECTED_PLUGIN_CHANGES: dict[str, Callable[[dict[str, Any]], None]] = {
    "unknown device field": lambda p: plugin_device(p).update(unexpected=True),
    "unknown runtime kind": lambda p: plugin_device(p)["plugin"].update(runtimeKind="vst2"),
    "bad module checksum": lambda p: plugin_device(p)["plugin"].update(moduleChecksumSha256="ABC"),
    "bad state encoding": lambda p: plugin_device(p)["pluginState"].update(encoding="xml"),
    "negative state version": lambda p: plugin_device(p)["pluginState"].update(stateVersion=-1),
    "missing automation": lambda p: plugin_device(p).pop("automation"),
    "negative automation tick": lambda p: first_point(p).update(tick=-1),
    "unknown automation curve": lambda p: first_point(p).update(curve="bezier"),
    "missing frozen field": lambda p: plugin_device(p).pop("frozen"),
    "frozen render id not a uuid": lambda p: plugin_device(p)["frozen"].update(renderId="render-1"),
    "frozen checksum malformed": lambda p: plugin_device(p)["frozen"].update(
        sourceSignalChainChecksumSha256="0" * 63
    ),
    "frozen unknown field": lambda p: plugin_device(p)["frozen"].update(extra=1),
}


@pytest.mark.parametrize("name", sorted(REJECTED_PLUGIN_CHANGES))
def test_json_schema_and_pydantic_reject_the_same_invalid_plugin_data(name: str) -> None:
    payload = mutate(PLUGIN_FIXTURE, REJECTED_PLUGIN_CHANGES[name])
    assert list(JSON_SCHEMA.iter_errors(payload)) != []
    with pytest.raises(ValidationError):
        MusicProjectV2.model_validate(payload)
