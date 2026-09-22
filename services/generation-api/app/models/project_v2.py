from typing import Literal

from pydantic import Field

from app.models.project import (
    AssetReference,
    Clip,
    GenerationMetadata,
    Marker,
    MusicProject,
    ProjectMetadata,
    StrictModel,
    TempoEvent,
    TimeSignatureEvent,
    Track,
    TransportSettings,
)


class PluginReference(StrictModel):
    pluginId: str = Field(min_length=1)
    vendorId: str | None
    version: str = Field(min_length=1)
    runtimeKind: Literal["builtin", "audio-worklet", "audio-worklet-wasm", "wam", "native-proxy"]
    moduleChecksumSha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class PluginStateEnvelope(StrictModel):
    stateVersion: int = Field(ge=0)
    encoding: Literal["json", "base64"]
    payload: str
    checksumSha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class DeviceV2(StrictModel):
    id: str = Field(min_length=1)
    deviceType: str = Field(min_length=1)
    deviceVersion: str = Field(min_length=1)
    enabled: bool
    parameters: list
    plugin: PluginReference
    pluginState: PluginStateEnvelope | None


class TrackV2(StrictModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    kind: Literal["instrument", "audio", "bus"]
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    muted: bool
    solo: bool
    volumeDb: float = Field(ge=-96, le=24)
    pan: float = Field(ge=-1, le=1)
    outputBusId: str | None = None
    devices: list[DeviceV2]
    clips: list[Clip]


class MusicProjectV2(StrictModel):
    schemaVersion: Literal[2]
    projectId: str = Field(min_length=1)
    revisionId: str = Field(min_length=1)
    parentRevisionId: str | None
    metadata: ProjectMetadata
    transport: TransportSettings
    tempoMap: list[TempoEvent] = Field(min_length=1)
    timeSignatureMap: list[TimeSignatureEvent] = Field(min_length=1)
    tracks: list[TrackV2]
    assets: list[AssetReference]
    markers: list[Marker]
    generationMetadata: GenerationMetadata | None = None


def migrate_project_v1_to_v2(project: MusicProject) -> MusicProjectV2:
    payload = project.model_dump(mode="json")
    payload["schemaVersion"] = 2
    for track in payload["tracks"]:
        for device in track["devices"]:
            device["plugin"] = {
                "pluginId": device["deviceType"],
                "vendorId": "synaptix",
                "version": device["deviceVersion"],
                "runtimeKind": "builtin",
                "moduleChecksumSha256": None,
            }
            device["pluginState"] = None
    return MusicProjectV2.model_validate(payload)
