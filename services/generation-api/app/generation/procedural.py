import random

from app.generation.orchestration import (
    PlannedBar,
    assemble_tracks,
    choose_ensemble,
    default_layers,
)
from app.generation.theory import Key, parse_key
from app.models.generation import (
    GeneratedMidiClip,
    GeneratedSection,
    GenerationProposal,
    GenerationProvenance,
    GenerationRequest,
)
from app.models.project import MidiNote, MusicalPosition, MusicalRange

TICKS_PER_QUARTER_NOTE = 960
TICKS_PER_BAR = TICKS_PER_QUARTER_NOTE * 4

# Kept for callers of the original minor-only API; new code uses app.generation.theory.
ROOT_MIDI_BY_KEY = {
    "C minor": 48,
    "D minor": 50,
    "E minor": 52,
    "F minor": 53,
    "G minor": 55,
    "A minor": 57,
}

MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)
CHORD_DEGREES = (0, 5, 3, 6)


def _position(bar: int) -> MusicalPosition:
    return MusicalPosition(bar=bar, beat=0, tick=0)


def _sections(duration_bars: int) -> list[GeneratedSection]:
    intro_bars = 4
    victory_bars = 2
    tension_bars = max(2, min(4, duration_bars // 4))
    main_bars = duration_bars - intro_bars - tension_bars - victory_bars
    if main_bars < 2:
        main_bars = 2
        intro_bars = 2
        tension_bars = 2
        victory_bars = duration_bars - intro_bars - main_bars - tension_bars

    sections = [
        GeneratedSection(
            id="section-intro",
            kind="intro",
            name="Intro",
            startBar=0,
            bars=intro_bars,
        ),
        GeneratedSection(
            id="section-main",
            kind="main",
            name="Main Loop",
            startBar=intro_bars,
            bars=main_bars,
        ),
        GeneratedSection(
            id="section-tension",
            kind="tension",
            name="Tension",
            startBar=intro_bars + main_bars,
            bars=tension_bars,
        ),
        GeneratedSection(
            id="section-victory",
            kind="victory",
            name="Victory",
            startBar=intro_bars + main_bars + tension_bars,
            bars=victory_bars,
        ),
    ]
    return [section for section in sections if section.bars > 0]


def _note(
    track_role: str,
    index: int,
    pitch: int,
    start_tick: int,
    duration_ticks: int,
    velocity: int,
) -> MidiNote:
    return MidiNote(
        id=f"note-{track_role}-{index}",
        pitch=max(0, min(127, pitch)),
        velocity=max(1, min(127, velocity)),
        startTick=start_tick,
        durationTicks=duration_ticks,
    )


def _drum_notes(bars: int, energy: float, rng: random.Random) -> list[MidiNote]:
    notes: list[MidiNote] = []
    index = 0
    for bar in range(bars):
        base = bar * TICKS_PER_BAR
        for beat in range(4):
            velocity = 88 + int(energy * 25) + rng.randint(-4, 4)
            notes.append(_note("drums", index, 36, base + beat * 960, 120, velocity))
            index += 1
            if beat in (1, 3):
                notes.append(_note("drums", index, 38, base + beat * 960, 120, 96))
                index += 1
        hat_step = 480 if energy < 0.75 else 240
        for step in range(0, TICKS_PER_BAR, hat_step):
            notes.append(_note("drums", index, 42, base + step, 90, 64 + rng.randint(-5, 5)))
            index += 1
    return notes


def _bass_notes(bars: int, key: Key, energy: float, rng: random.Random) -> list[MidiNote]:
    notes: list[MidiNote] = []
    for bar in range(bars):
        degree = key.progression[bar % len(key.progression)]
        pitch = key.pitch(degree, octave=-1)
        for beat in range(4):
            index = bar * 4 + beat
            variation = 12 if beat == 3 and rng.random() < energy * 0.35 else 0
            notes.append(
                _note(
                    "bass",
                    index,
                    pitch + variation,
                    bar * TICKS_PER_BAR + beat * 960,
                    720,
                    84 + int(energy * 24),
                )
            )
    return notes


def _harmony_notes(bars: int, key: Key) -> list[MidiNote]:
    notes: list[MidiNote] = []
    index = 0
    for bar in range(bars):
        degree = key.progression[bar % len(key.progression)]
        # Diatonic triads: stacked thirds within the scale, so every chord stays in key.
        for pitch in key.triad(degree):
            notes.append(
                _note(
                    "harmony",
                    index,
                    pitch,
                    bar * TICKS_PER_BAR,
                    TICKS_PER_BAR,
                    70,
                )
            )
            index += 1
    return notes


def _melody_notes(
    bars: int,
    key: Key,
    complexity: float,
    energy: float,
    rng: random.Random,
) -> list[MidiNote]:
    notes: list[MidiNote] = []
    steps_per_bar = 4 if complexity < 0.6 else 8
    step_ticks = TICKS_PER_BAR // steps_per_bar
    previous_degree = 4
    index = 0
    for bar in range(bars):
        for step in range(steps_per_bar):
            if rng.random() > 0.55 + complexity * 0.35:
                continue
            movement = rng.choice((-2, -1, 0, 1, 2))
            previous_degree = max(0, min(len(key.scale) - 1, previous_degree + movement))
            octave = 1 if energy > 0.7 and rng.random() < 0.18 else 0
            pitch = key.pitch(previous_degree, octave=1 + octave)
            notes.append(
                _note(
                    "melody",
                    index,
                    pitch,
                    bar * TICKS_PER_BAR + step * step_ticks,
                    max(120, int(step_ticks * 0.8)),
                    78 + int(energy * 30) + rng.randint(-3, 3),
                )
            )
            index += 1
    return notes


def _clip(role: str, bars: int, notes: list[MidiNote]) -> GeneratedMidiClip:
    return GeneratedMidiClip(
        id=f"clip-{role}-arrangement",
        name=f"{role.title()} Arrangement",
        range=MusicalRange(start=_position(0), durationTicks=bars * TICKS_PER_BAR),
        loop=False,
        notes=notes,
    )


def generate_arrangement(request: GenerationRequest) -> GenerationProposal:
    rng = random.Random(request.seed)
    key = parse_key(request.key)
    sections = _sections(request.durationBars)

    drum_notes = _drum_notes(request.durationBars, request.energy, rng)
    bass_notes = _bass_notes(
        request.durationBars,
        key,
        request.energy,
        rng,
    )
    harmony_notes = _harmony_notes(request.durationBars, key)
    melody_notes = _melody_notes(
        request.durationBars,
        key,
        request.complexity,
        request.energy,
        rng,
    )

    ensemble = choose_ensemble(key, request.mood, request.energy, request.complexity)
    section_energy = {"intro": -0.15, "main": 0.0, "tension": 0.15, "victory": 0.1}
    plan = [
        PlannedBar(
            bar=bar,
            degree=key.progression[bar % len(key.progression)],
            kind=section.kind,
            energy=max(0.0, min(1.0, request.energy + section_energy[section.kind])),
            layers=default_layers(ensemble, section.kind),
        )
        for section in sections
        for bar in range(section.startBar, section.startBar + section.bars)
    ]
    tracks = assemble_tracks(
        key,
        request.durationBars,
        ensemble,
        {"drums": drum_notes, "bass": bass_notes, "harmony": harmony_notes, "melody": melody_notes},
        plan,
    )

    return GenerationProposal(
        operation="create-arrangement",
        projectId=request.projectId,
        genre=request.genre,
        mood=request.mood,
        tempo=request.tempo,
        key=request.key,
        ticksPerQuarterNote=TICKS_PER_QUARTER_NOTE,
        sections=sections,
        tracks=tracks,
        provenance=GenerationProvenance(
            generatorId="synaptix-procedural-composer",
            generatorVersion="0.2.0",
            seed=request.seed,
        ),
        warnings=[],
    )
