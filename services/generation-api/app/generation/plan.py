"""Arrangement plans: a compact musical description an AI composer writes,
rendered here into notes.

Composers describe *what* to play (chords per bar, 16-step drum and bass
patterns, melody phrases in scale degrees). This module decides *how* it
becomes MIDI, so every note is in key, inside its clip, and on the grid no
matter what the plan contains.
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.generation.procedural import (
    MINOR_SCALE,
    ROOT_MIDI_BY_KEY,
    TICKS_PER_BAR,
    TICKS_PER_QUARTER_NOTE,
)
from app.models.generation import (
    GeneratedMidiClip,
    GeneratedSection,
    GeneratedTrack,
    GenerationProposal,
    GenerationProvenance,
    GenerationRequest,
    GeneratorId,
)
from app.models.project import MidiNote, MusicalPosition, MusicalRange

STEPS_PER_BAR = 16
STEP_TICKS = TICKS_PER_BAR // STEPS_PER_BAR
KICK, SNARE, HAT = 36, 38, 42
MIN_SECTIONS = 3


class PlanDrums(BaseModel):
    kick: str = Field(description="16 characters: 'x' hit, 'X' accented hit, '.' rest")
    snare: str = Field(description="16 characters: 'x' hit, 'X' accented hit, '.' rest")
    hat: str = Field(description="16 characters: 'x' hit, 'X' accented hit, '.' rest")


class PlanMelodyNote(BaseModel):
    step: int = Field(description="Start step within the bar, 0-15")
    degree: int = Field(
        description="Natural-minor scale degree: 0 = tonic, 1-6 up the scale, 7 = octave, "
        "negative values go below the tonic (range -7 to 14)"
    )
    length: int = Field(description="Duration in 16th-note steps, 1-16")
    accent: bool = False


class PlanSection(BaseModel):
    kind: Literal["intro", "main", "tension", "victory"]
    name: str
    bars: int = Field(description="Length in bars, at least 1")
    energy: float = Field(description="0 (sparse, soft) to 1 (full, loud)")
    chords: list[int] = Field(
        description="One natural-minor scale degree (0-6) per bar for the chord root; "
        "repeats if shorter than the section"
    )
    harmony: Literal["sustained", "stabs", "arpeggio"]
    bass: str = Field(
        description="16 characters: 'x' plays the chord root, 'o' plays it an octave up, '.' rest"
    )
    drums: PlanDrums
    melody: list[list[PlanMelodyNote]] = Field(
        description="A phrase as a list of bars (each a list of notes); it repeats across "
        "the section. Use an empty bar for rests."
    )


class ArrangementPlan(BaseModel):
    title: str
    sections: list[PlanSection]


class PlanRenderError(ValueError):
    """The plan cannot become a usable arrangement (e.g. too few sections)."""


def _steps(pattern: str) -> str:
    """Normalizes a step pattern to exactly 16 characters."""
    return (pattern.strip() + "." * STEPS_PER_BAR)[:STEPS_PER_BAR]


def _pitch(root: int, degree: int) -> int:
    degree = max(-7, min(14, degree))
    octave, index = divmod(degree, len(MINOR_SCALE))
    return max(0, min(127, root + 12 * octave + MINOR_SCALE[index]))


def _fit_sections(sections: list[PlanSection], total_bars: int) -> list[tuple[PlanSection, int]]:
    """Scales section lengths so they add up to exactly [total_bars]."""
    sections = [section for section in sections if section.bars > 0]
    if len(sections) < MIN_SECTIONS:
        raise PlanRenderError(f"The plan needs at least {MIN_SECTIONS} sections.")
    if len(sections) > total_bars:
        sections = sections[:total_bars]
    planned = sum(section.bars for section in sections)
    lengths = [max(1, round(section.bars * total_bars / planned)) for section in sections]
    # Absorb rounding into the longest sections, never shrinking one below a bar.
    while sum(lengths) != total_bars:
        index = max(range(len(lengths)), key=lengths.__getitem__)
        if sum(lengths) > total_bars:
            if lengths[index] == 1:
                raise PlanRenderError("The plan's sections cannot fit the requested length.")
            lengths[index] -= 1
        else:
            lengths[index] += 1
    return list(zip(sections, lengths, strict=True))


class _Track:
    def __init__(self, role: str) -> None:
        self.role = role
        self.notes: list[MidiNote] = []

    def add(self, pitch: int, start: int, duration: int, velocity: int, end: int) -> None:
        duration = min(duration, end - start)
        if duration <= 0 or start < 0:
            return
        self.notes.append(
            MidiNote(
                id=f"note-{self.role}-{len(self.notes)}",
                pitch=max(0, min(127, pitch)),
                velocity=max(1, min(127, velocity)),
                startTick=start,
                durationTicks=duration,
            )
        )


def render_plan(
    request: GenerationRequest,
    plan: ArrangementPlan,
    *,
    generator_id: GeneratorId,
    generator_version: str,
    model: str | None = None,
) -> GenerationProposal:
    root = ROOT_MIDI_BY_KEY[request.key]
    fitted = _fit_sections(plan.sections, request.durationBars)
    clip_end = request.durationBars * TICKS_PER_BAR
    drums, bass, harmony, melody = (_Track(r) for r in ("drums", "bass", "harmony", "melody"))
    sections: list[GeneratedSection] = []

    bar = 0
    for index, (section, length) in enumerate(fitted):
        sections.append(
            GeneratedSection(
                id=f"section-{index}-{section.kind}",
                kind=section.kind,
                name=section.name.strip() or section.kind.title(),
                startBar=bar,
                bars=length,
            )
        )
        energy = max(0.0, min(1.0, section.energy))
        base_velocity = 64 + round(energy * 40)
        chords = [max(0, min(6, degree)) for degree in section.chords] or [0]
        phrase = section.melody or [[]]
        patterns = {
            KICK: _steps(section.drums.kick),
            SNARE: _steps(section.drums.snare),
            HAT: _steps(section.drums.hat),
        }
        bass_steps = _steps(section.bass)

        for offset in range(length):
            start = (bar + offset) * TICKS_PER_BAR
            chord = chords[offset % len(chords)]

            for pitch, steps in patterns.items():
                for step, hit in enumerate(steps):
                    if hit in "xX":
                        accent = 18 if hit == "X" else 0
                        velocity = base_velocity + accent - (12 if pitch == HAT else 0)
                        drums.add(pitch, start + step * STEP_TICKS, 120, velocity, clip_end)

            for step, hit in enumerate(bass_steps):
                if hit in "xo":
                    pitch = _pitch(root - 12, chord) + (12 if hit == "o" else 0)
                    length_steps = next(
                        (i for i in range(1, STEPS_PER_BAR - step) if bass_steps[step + i] != "."),
                        STEPS_PER_BAR - step,
                    )
                    bass.add(
                        pitch,
                        start + step * STEP_TICKS,
                        max(1, length_steps * STEP_TICKS - 30),
                        base_velocity,
                        clip_end,
                    )

            triad = [_pitch(root, chord + interval) for interval in (0, 2, 4)]
            if section.harmony == "sustained":
                for pitch in triad:
                    harmony.add(pitch, start, TICKS_PER_BAR, base_velocity - 12, clip_end)
            elif section.harmony == "stabs":
                for beat in (0, 2):
                    for pitch in triad:
                        harmony.add(
                            pitch,
                            start + beat * TICKS_PER_QUARTER_NOTE,
                            360,
                            base_velocity - 6,
                            clip_end,
                        )
            else:
                for step in range(0, STEPS_PER_BAR, 2):
                    harmony.add(
                        triad[(step // 2) % len(triad)],
                        start + step * STEP_TICKS,
                        STEP_TICKS * 2 - 20,
                        base_velocity - 10,
                        clip_end,
                    )

            for note in phrase[offset % len(phrase)]:
                step = max(0, min(STEPS_PER_BAR - 1, note.step))
                length_steps = max(1, min(STEPS_PER_BAR, note.length))
                melody.add(
                    _pitch(root + 12, note.degree),
                    start + step * STEP_TICKS,
                    length_steps * STEP_TICKS - 20,
                    base_velocity + (16 if note.accent else 4),
                    clip_end,
                )
        bar += length

    def clip(track: _Track) -> GeneratedMidiClip:
        return GeneratedMidiClip(
            id=f"clip-{track.role}-arrangement",
            name=f"{track.role.title()} Arrangement",
            range=MusicalRange(
                start=MusicalPosition(bar=0, beat=0, tick=0), durationTicks=clip_end
            ),
            loop=False,
            notes=track.notes,
        )

    warnings: list[str] = []
    if not melody.notes:
        warnings.append("The plan contained no melody notes.")

    return GenerationProposal(
        operation="create-arrangement",
        projectId=request.projectId,
        genre=request.genre,
        mood=request.mood,
        tempo=request.tempo,
        key=request.key,
        ticksPerQuarterNote=TICKS_PER_QUARTER_NOTE,
        sections=sections,
        tracks=[
            GeneratedTrack(
                id="track-drums",
                role="drums",
                name="Drums",
                instrumentId="synaptix-drum-machine-01",
                clips=[clip(drums)],
            ),
            GeneratedTrack(
                id="track-bass",
                role="bass",
                name="Bass",
                instrumentId="synaptix-bass-synth-01",
                clips=[clip(bass)],
            ),
            GeneratedTrack(
                id="track-harmony",
                role="harmony",
                name="Harmony",
                instrumentId="synaptix-poly-synth-01",
                clips=[clip(harmony)],
            ),
            GeneratedTrack(
                id="track-melody",
                role="melody",
                name="Lead Melody",
                instrumentId="synaptix-lead-synth-01",
                clips=[clip(melody)],
            ),
        ],
        provenance=GenerationProvenance(
            generatorId=generator_id,
            generatorVersion=generator_version,
            seed=request.seed,
            model=model,
        ),
        warnings=warnings,
    )
