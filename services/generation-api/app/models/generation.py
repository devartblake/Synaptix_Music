from typing import Literal

from pydantic import Field, model_validator

from app.models.project import MidiNote, MusicalPosition, MusicalRange, StrictModel


class GenerationRequest(StrictModel):
    projectId: str = Field(min_length=1)
    genre: Literal["electronic-trivia"] = "electronic-trivia"
    mood: Literal["upbeat", "tense", "triumphant"] = "upbeat"
    tempo: int = Field(default=120, ge=90, le=140)
    key: Literal["C minor", "D minor", "E minor", "F minor", "G minor", "A minor"] = "D minor"
    durationBars: int = Field(default=16, ge=8, le=64)
    energy: float = Field(default=0.6, ge=0, le=1)
    complexity: float = Field(default=0.5, ge=0, le=1)
    seed: int = Field(default=1, ge=0, le=2_147_483_647)


class GeneratedSection(StrictModel):
    id: str = Field(min_length=1)
    kind: Literal["intro", "main", "tension", "victory"]
    name: str = Field(min_length=1)
    startBar: int = Field(ge=0)
    bars: int = Field(gt=0)


class GeneratedMidiClip(StrictModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    range: MusicalRange
    loop: bool
    notes: list[MidiNote]


class GeneratedTrack(StrictModel):
    id: str = Field(min_length=1)
    role: Literal["drums", "bass", "harmony", "melody"]
    name: str = Field(min_length=1)
    instrumentId: str = Field(min_length=1)
    clips: list[GeneratedMidiClip]


class GenerationProvenance(StrictModel):
    generatorId: Literal["synaptix-procedural-composer"]
    generatorVersion: Literal["0.1.0"]
    seed: int


class GenerationProposal(StrictModel):
    operation: Literal["create-arrangement"]
    projectId: str = Field(min_length=1)
    genre: Literal["electronic-trivia"]
    mood: Literal["upbeat", "tense", "triumphant"]
    tempo: int
    key: str
    ticksPerQuarterNote: Literal[960]
    sections: list[GeneratedSection] = Field(min_length=3)
    tracks: list[GeneratedTrack] = Field(min_length=4)
    provenance: GenerationProvenance
    warnings: list[str]

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "GenerationProposal":
        identifiers: list[str] = [section.id for section in self.sections]
        for track in self.tracks:
            identifiers.append(track.id)
            identifiers.extend(clip.id for clip in track.clips)
            for clip in track.clips:
                identifiers.extend(note.id for note in clip.notes)
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Generated arrangement identifiers must be unique.")
        return self


ORIGIN = MusicalPosition(bar=0, beat=0, tick=0)
