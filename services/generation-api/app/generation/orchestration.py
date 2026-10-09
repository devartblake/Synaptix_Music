"""Instruments, roles and the parts they play.

Composers choose an ensemble (an instrument for each role) and which layers play in each
section; the part writers here turn a section's chords into notes for the supporting roles,
so every part stays in key and in time whichever composer made the choices.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import get_args

from app.generation.theory import Key
from app.models.generation import GeneratedMidiClip, GeneratedTrack, TrackRole
from app.models.project import MidiNote, MusicalPosition, MusicalRange

TICKS_PER_QUARTER = 960
TICKS_PER_BAR = TICKS_PER_QUARTER * 4

# The studio's instrument catalog (packages/daw-engine/src/instrument-catalog.ts).
INSTRUMENTS: dict[str, str] = {
    "synaptix-drum-synth": "Drum Synth",
    "synaptix-sub-bass": "Sub Bass",
    "synaptix-bass-synth": "Bass Synth",
    "synaptix-lead-synth": "Lead Synth",
    "synaptix-pad": "Warm Pad",
    "synaptix-pluck": "Pluck",
    "synaptix-electric-piano": "Electric Piano",
    "synaptix-organ": "Organ",
    "synaptix-strings": "String Ensemble",
    "synaptix-brass": "Brass Section",
    "synaptix-bell": "Bell",
    "synaptix-poly-synth": "Poly Synth",
    "synaptix-supersaw": "Supersaw Lead",
    "synaptix-unison": "Unison Pad",
    "synaptix-guitar": "Plucked String",
    "synaptix-fm-glass": "FM Bell",
    "synaptix-fm-ep": "FM Electric Piano",
    "synaptix-beat-kit": "Drum Kit",
    "synaptix-boom": "808 Bass",
    "synaptix-chiptune": "Chiptune Lead",
    "synaptix-squelch": "Acid Bass",
    "synaptix-motion": "Motion Pad",
    "synaptix-wobble": "Wobble Bass",
    "synaptix-reese": "Reese Bass",
    "synaptix-ensemble": "Ensemble Strings",
    "synaptix-uplift": "Trance Pluck",
    "synaptix-riser": "Riser FX",
    "synaptix-downsweep": "Downsweep FX",
}

ROLES: tuple[TrackRole, ...] = get_args(TrackRole)
CORE_ROLES: tuple[TrackRole, ...] = ("drums", "bass", "harmony", "melody")
LAYER_ROLES: tuple[TrackRole, ...] = tuple(role for role in ROLES if role not in CORE_ROLES)

# Instruments that suit each role; the first is the default.
ROLE_INSTRUMENTS: dict[TrackRole, tuple[str, ...]] = {
    "drums": ("synaptix-drum-synth",),
    "bass": ("synaptix-bass-synth", "synaptix-sub-bass"),
    "sub-bass": ("synaptix-sub-bass",),
    "harmony": (
        "synaptix-poly-synth",
        "synaptix-electric-piano",
        "synaptix-organ",
        "synaptix-strings",
    ),
    "pad": ("synaptix-pad", "synaptix-strings", "synaptix-organ"),
    "arpeggio": (
        "synaptix-pluck",
        "synaptix-bell",
        "synaptix-electric-piano",
        "synaptix-poly-synth",
    ),
    "melody": (
        "synaptix-lead-synth",
        "synaptix-organ",
        "synaptix-pluck",
        "synaptix-brass",
        "synaptix-strings",
        "synaptix-bell",
        "synaptix-electric-piano",
    ),
    "countermelody": (
        "synaptix-strings",
        "synaptix-electric-piano",
        "synaptix-bell",
        "synaptix-organ",
    ),
    "stabs": ("synaptix-brass", "synaptix-organ", "synaptix-poly-synth", "synaptix-pluck"),
    "sparkle": ("synaptix-bell", "synaptix-pluck"),
}

ROLE_NAMES: dict[TrackRole, str] = {
    "drums": "Drums",
    "bass": "Bass",
    "sub-bass": "Sub Bass",
    "harmony": "Harmony",
    "pad": "Pad",
    "arpeggio": "Arpeggio",
    "melody": "Lead Melody",
    "countermelody": "Countermelody",
    "stabs": "Stabs",
    "sparkle": "Sparkle",
}


@dataclass(frozen=True)
class Mix:
    volume_db: float
    pan: float
    reverb_send: float


# Levels balanced against rendered stems: lead and bass on top, textures underneath.
ROLE_MIX: dict[TrackRole, Mix] = {
    "drums": Mix(-7, 0, 0),
    "bass": Mix(-10, 0, 0),
    "sub-bass": Mix(-13, 0, 0),
    "harmony": Mix(-15, -0.2, 0.15),
    "pad": Mix(-17, 0, 0.35),
    "arpeggio": Mix(-15, 0.3, 0.2),
    "melody": Mix(-10, 0, 0.2),
    "countermelody": Mix(-15, -0.3, 0.25),
    "stabs": Mix(-14, 0.15, 0.2),
    "sparkle": Mix(-16, 0.35, 0.4),
}

# When a plan doesn't say, which section kinds each layer plays in.
DEFAULT_LAYER_SECTIONS: dict[TrackRole, frozenset[str]] = {
    "sub-bass": frozenset({"main", "tension"}),
    "pad": frozenset({"intro", "main"}),
    "arpeggio": frozenset({"main", "tension"}),
    "countermelody": frozenset({"main", "victory"}),
    "stabs": frozenset({"tension", "victory"}),
    "sparkle": frozenset({"intro", "victory"}),
}


def instrument_for(role: TrackRole, requested: str | None) -> str:
    """The requested instrument if it suits the role, otherwise the role's default."""
    options = ROLE_INSTRUMENTS[role]
    return requested if requested in options else options[0]


def choose_ensemble(key: Key, mood: str, energy: float, complexity: float) -> dict[TrackRole, str]:
    """A procedural instrument choice that follows the mood and the mode's colour."""
    bright = key.mode in ("major", "mixolydian")
    dark = key.mode in ("phrygian", "harmonic minor")
    melody = (
        "synaptix-organ"
        if bright and mood == "upbeat"
        else "synaptix-brass"
        if mood == "triumphant"
        else "synaptix-bell"
        if key.mode == "lydian"
        else "synaptix-electric-piano"
        if key.mode == "dorian" and energy < 0.6
        else "synaptix-lead-synth"
    )
    harmony = (
        "synaptix-electric-piano"
        if key.mode == "dorian"
        else "synaptix-strings"
        if mood == "triumphant"
        else "synaptix-organ"
        if key.mode == "mixolydian"
        else "synaptix-poly-synth"
    )
    ensemble: dict[TrackRole, str] = {
        "drums": "synaptix-drum-synth",
        "bass": "synaptix-bass-synth",
        "harmony": harmony,
        "melody": melody,
    }
    if energy < 0.7 or key.mode == "lydian":
        ensemble["pad"] = (
            "synaptix-strings" if harmony == "synaptix-poly-synth" and dark else "synaptix-pad"
        )
    if complexity >= 0.45:
        bell_free = melody != "synaptix-bell"
        ensemble["arpeggio"] = (
            "synaptix-bell" if key.mode == "lydian" and bell_free else "synaptix-pluck"
        )
    if mood == "triumphant" or (mood == "tense" and energy > 0.7):
        ensemble["stabs"] = "synaptix-organ" if melody == "synaptix-brass" else "synaptix-brass"
    if mood == "triumphant" or key.mode in ("major", "lydian"):
        # Sparkle on whichever of bell or pluck isn't already carrying another part.
        used = set(ensemble.values())
        ensemble["sparkle"] = "synaptix-bell" if "synaptix-bell" not in used else "synaptix-pluck"
        if ensemble["sparkle"] in used and "synaptix-pluck" in used:
            del ensemble["sparkle"]
    if mood == "tense" or dark:
        ensemble["sub-bass"] = "synaptix-sub-bass"
    if complexity >= 0.7:
        ensemble["countermelody"] = (
            "synaptix-electric-piano"
            if "synaptix-strings" in (harmony, ensemble.get("pad"))
            else "synaptix-strings"
        )
    return ensemble


Note = tuple[int, int, int, int]
"""(start tick, pitch, duration ticks, velocity)."""


def write_layer(
    role: TrackRole, key: Key, bars: Iterable[tuple[int, int, str, float]]
) -> list[Note]:
    """Notes for a supporting role over (bar index, chord degree, section kind, energy) bars."""
    writer = {
        "sub-bass": _sub_bass,
        "pad": _pad,
        "arpeggio": _arpeggio,
        "countermelody": _countermelody,
        "stabs": _stabs,
        "sparkle": _sparkle,
    }[role]
    notes: list[Note] = []
    previous: tuple[int, str] | None = None
    for bar, degree, kind, energy in bars:
        first_of_section = previous is None or previous != (bar - 1, kind)
        notes.extend(writer(key, bar * TICKS_PER_BAR, degree, energy, first_of_section, bar))
        previous = (bar, kind)
    return notes


def _velocity(energy: float, base: int, span: int = 30) -> int:
    return max(1, min(127, base + round(energy * span)))


def _sub_bass(
    key: Key, start: int, degree: int, energy: float, _first: bool, _bar: int
) -> list[Note]:
    return [(start, key.pitch(degree, octave=-1), TICKS_PER_BAR - 60, _velocity(energy, 70))]


def _pad(key: Key, start: int, degree: int, energy: float, _first: bool, _bar: int) -> list[Note]:
    return [(start, pitch, TICKS_PER_BAR, _velocity(energy, 52, 20)) for pitch in key.triad(degree)]


def _arpeggio(
    key: Key, start: int, degree: int, energy: float, _first: bool, _bar: int
) -> list[Note]:
    tones = [*key.triad(degree, octave=1), key.pitch(degree + 7, octave=1)]
    order = (0, 1, 2, 3, 2, 1, 2, 1)
    step = TICKS_PER_QUARTER // (4 if energy >= 0.55 else 2)
    count = TICKS_PER_BAR // step
    return [
        (
            start + index * step,
            tones[order[index % len(order)]],
            step - 40,
            _velocity(energy, 70 if index % 4 == 0 else 58, 24),
        )
        for index in range(count)
    ]


def _countermelody(
    key: Key, start: int, degree: int, energy: float, _first: bool, bar: int
) -> list[Note]:
    # A guide-tone line: the chord's third, then its fifth, moving smoothly under the lead.
    first, second = (degree + 2, degree + 4) if bar % 2 == 0 else (degree + 4, degree + 2)
    half = TICKS_PER_BAR // 2
    return [
        (start, key.pitch(first, octave=1), half - 40, _velocity(energy, 64, 20)),
        (start + half, key.pitch(second, octave=1), half - 40, _velocity(energy, 60, 20)),
    ]


def _stabs(key: Key, start: int, degree: int, energy: float, first: bool, _bar: int) -> list[Note]:
    chord = key.triad(degree, octave=1)
    if first:  # a fanfare to open the section: da-da-da DAAA
        hits = [(0, 300, 96), (480, 300, 96), (960, 300, 100), (1440, 2200, 112)]
    elif energy >= 0.7:
        hits = [(0, 360, 104), (1440, 360, 96), (2880, 360, 100)]
    else:
        hits = [(0, 480, 96), (1920, 480, 92)]
    return [
        (start + offset, pitch, length, velocity)
        for offset, length, velocity in hits
        for pitch in chord
    ]


def _sparkle(key: Key, start: int, degree: int, energy: float, first: bool, bar: int) -> list[Note]:
    if not (first or bar % 2 == 0):
        return []
    tones = [key.pitch(degree + step, octave=2) for step in (0, 2, 4, 7)]
    offset = 0 if first else TICKS_PER_BAR // 2
    return [
        (start + offset + index * 240, pitch, 360, _velocity(energy, 58, 20))
        for index, pitch in enumerate(tones)
    ]


@dataclass(frozen=True)
class PlannedBar:
    bar: int
    degree: int
    kind: str
    energy: float
    layers: frozenset[str]
    """Supporting roles that play in this bar."""


def assemble_tracks(
    key: Key,
    duration_bars: int,
    ensemble: dict[TrackRole, str],
    core_notes: dict[TrackRole, list[MidiNote]],
    plan: list[PlannedBar],
) -> list[GeneratedTrack]:
    """Tracks for the core parts plus every supporting layer in the ensemble, with mix hints."""
    clip_range = MusicalRange(
        start=MusicalPosition(bar=0, beat=0, tick=0), durationTicks=duration_bars * TICKS_PER_BAR
    )
    end = duration_bars * TICKS_PER_BAR
    tracks: list[GeneratedTrack] = []
    for role in ROLES:
        if role in CORE_ROLES:
            notes = core_notes.get(role, [])
        elif role in ensemble:
            raw = write_layer(
                role, key, ((b.bar, b.degree, b.kind, b.energy) for b in plan if role in b.layers)
            )
            notes = [
                MidiNote(
                    id=f"note-{role}-{index}",
                    pitch=max(0, min(127, pitch)),
                    velocity=velocity,
                    startTick=start,
                    durationTicks=min(duration, end - start),
                )
                for index, (start, pitch, duration, velocity) in enumerate(raw)
                if start < end
            ]
        else:
            continue
        if not notes and role not in CORE_ROLES:
            continue
        instrument = instrument_for(role, ensemble.get(role))
        mix = ROLE_MIX[role]
        tracks.append(
            GeneratedTrack(
                id=f"track-{role}",
                role=role,
                name=f"{ROLE_NAMES[role]} ({INSTRUMENTS[instrument]})"
                if role not in ("drums", "bass")
                else ROLE_NAMES[role],
                instrumentId=instrument,
                clips=[
                    GeneratedMidiClip(
                        id=f"clip-{role}-arrangement",
                        name=f"{ROLE_NAMES[role]} Arrangement",
                        range=clip_range,
                        loop=False,
                        notes=notes,
                    )
                ],
                volumeDb=mix.volume_db,
                pan=mix.pan,
                reverbSend=mix.reverb_send,
            )
        )
    return tracks


def default_layers(ensemble: dict[TrackRole, str], kind: str) -> frozenset[str]:
    return frozenset(
        role for role in LAYER_ROLES if role in ensemble and kind in DEFAULT_LAYER_SECTIONS[role]
    )
