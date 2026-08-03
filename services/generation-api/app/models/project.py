from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MusicalPosition(StrictModel):
    bar: int = Field(ge=0)
    beat: int = Field(ge=0)
    tick: int = Field(ge=0)


class MusicalRange(StrictModel):
    start: MusicalPosition
    durationTicks: int = Field(gt=0)


class TempoEvent(StrictModel):
    id: str = Field(min_length=1)
    position: MusicalPosition
    bpm: float = Field(ge=20, le=400)


class TimeSignatureEvent(StrictModel):
    id: str = Field(min_length=1)
    position: MusicalPosition
    numerator: int = Field(ge=1, le=32)
    denominator: Literal[1, 2, 4, 8, 16, 32]


class MidiNote(StrictModel):
    id: str = Field(min_length=1)
    pitch: int = Field(ge=0, le=127)
    velocity: int = Field(ge=1, le=127)
    startTick: int = Field(ge=0)
    durationTicks: int = Field(gt=0)


class MidiClip(StrictModel):
    id: str = Field(min_length=1)
    kind: Literal["midi"]
    name: str = Field(min_length=1)
    range: MusicalRange
    loop: bool
    notes: list[MidiNote]


class AudioClip(StrictModel):
    id: str = Field(min_length=1)
    kind: Literal["audio"]
    name: str = Field(min_length=1)
    range: MusicalRange
    loop: bool
    assetId: str = Field(min_length=1)
    sourceOffsetSeconds: float = Field(ge=0)
    gainDb: float = Field(ge=-96, le=24)


Clip = Annotated[MidiClip | AudioClip, Field(discriminator="kind")]


class DeviceParameter(StrictModel):
    id: str = Field(min_length=1)
    value: float


class Device(StrictModel):
    id: str = Field(min_length=1)
    deviceType: str = Field(min_length=1)
    deviceVersion: str = Field(min_length=1)
    enabled: bool
    parameters: list[DeviceParameter]


class Track(StrictModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    kind: Literal["instrument", "audio", "bus"]
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    muted: bool
    solo: bool
    volumeDb: float = Field(ge=-96, le=24)
    pan: float = Field(ge=-1, le=1)
    outputBusId: str | None = None
    devices: list[Device]
    clips: list[Clip]


class AssetReference(StrictModel):
    id: str = Field(min_length=1)
    kind: Literal["audio", "soundfont", "impulse-response"]
    uri: str = Field(min_length=1)
    mediaType: str = Field(min_length=1)
    checksumSha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    durationSeconds: float | None = Field(default=None, gt=0)
    licenseId: str | None = None


class Marker(StrictModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    position: MusicalPosition
    kind: Literal["section", "cue", "loop-start", "loop-end"]


class ProjectMetadata(StrictModel):
    name: str = Field(min_length=1)
    createdAt: datetime
    updatedAt: datetime


class TransportSettings(StrictModel):
    ticksPerQuarterNote: int = Field(gt=0)
    loopEnabled: bool
    loopRange: MusicalRange | None


class GenerationMetadata(StrictModel):
    generatorId: str = Field(min_length=1)
    generatorVersion: str = Field(min_length=1)
    seed: int
    createdAt: datetime
    prompt: str | None = None


class MusicProject(StrictModel):
    schemaVersion: Literal[1]
    projectId: str = Field(min_length=1)
    revisionId: str = Field(min_length=1)
    parentRevisionId: str | None
    metadata: ProjectMetadata
    transport: TransportSettings
    tempoMap: list[TempoEvent] = Field(min_length=1)
    timeSignatureMap: list[TimeSignatureEvent] = Field(min_length=1)
    tracks: list[Track]
    assets: list[AssetReference]
    markers: list[Marker]
    generationMetadata: GenerationMetadata | None = None
