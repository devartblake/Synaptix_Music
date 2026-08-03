import random

from app.models.generation import (
    GeneratedMidiClip,
    GeneratedSection,
    GeneratedTrack,
    GenerationProposal,
    GenerationProvenance,
    GenerationRequest,
)
from app.models.project import MidiNote, MusicalPosition, MusicalRange

TICKS_PER_QUARTER_NOTE = 960
TICKS_PER_BAR = TICKS_PER_QUARTER_NOTE * 4

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


def _bass_notes(
    bars: int, root: int, energy: float, rng: random.Random
) -> list[MidiNote]:
    notes: list[MidiNote] = []
    for bar in range(bars):
        degree = CHORD_DEGREES[bar % len(CHORD_DEGREES)]
        pitch = root - 12 + MINOR_SCALE[degree]
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


def _harmony_notes(bars: int, root: int) -> list[MidiNote]:
    notes: list[MidiNote] = []
    index = 0
    for bar in range(bars):
        degree = CHORD_DEGREES[bar % len(CHORD_DEGREES)]
        chord_root = root + MINOR_SCALE[degree]
        chord = (chord_root, chord_root + 3, chord_root + 7)
        for pitch in chord:
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
    root: int,
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
            previous_degree = max(0, min(len(MINOR_SCALE) - 1, previous_degree + movement))
            octave = 12 if energy > 0.7 and rng.random() < 0.18 else 0
            pitch = root + 12 + MINOR_SCALE[previous_degree] + octave
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
    root = ROOT_MIDI_BY_KEY[request.key]
    sections = _sections(request.durationBars)

    drum_notes = _drum_notes(request.durationBars, request.energy, rng)
    bass_notes = _bass_notes(
        request.durationBars,
        root,
        request.energy,
        rng,
    )
    harmony_notes = _harmony_notes(request.durationBars, root)
    melody_notes = _melody_notes(
        request.durationBars,
        root,
        request.complexity,
        request.energy,
        rng,
    )

    tracks = [
        GeneratedTrack(
            id="track-drums",
            role="drums",
            name="Drums",
            instrumentId="synaptix-drum-machine-01",
            clips=[_clip("drums", request.durationBars, drum_notes)],
        ),
        GeneratedTrack(
            id="track-bass",
            role="bass",
            name="Bass",
            instrumentId="synaptix-bass-synth-01",
            clips=[_clip("bass", request.durationBars, bass_notes)],
        ),
        GeneratedTrack(
            id="track-harmony",
            role="harmony",
            name="Harmony",
            instrumentId="synaptix-poly-synth-01",
            clips=[_clip("harmony", request.durationBars, harmony_notes)],
        ),
        GeneratedTrack(
            id="track-melody",
            role="melody",
            name="Lead Melody",
            instrumentId="synaptix-lead-synth-01",
            clips=[_clip("melody", request.durationBars, melody_notes)],
        ),
    ]

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
            generatorVersion="0.1.0",
            seed=request.seed,
        ),
        warnings=[],
    )
