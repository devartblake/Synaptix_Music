"""Keys, modes and diatonic harmony shared by every composer.

A key is written "<tonic> <mode>", e.g. "D minor", "C major", "F# dorian" or
"A harmonic minor". Scale degrees are 0-based (0 = tonic, 6 = seventh); degrees
outside 0-6 wrap into neighbouring octaves.
"""

from dataclasses import dataclass

TONICS = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
PITCH_CLASS = {name: index for index, name in enumerate(TONICS)}

# Semitones above the tonic for each degree.
MODES: dict[str, tuple[int, ...]] = {
    "major": (0, 2, 4, 5, 7, 9, 11),
    "minor": (0, 2, 3, 5, 7, 8, 10),
    "dorian": (0, 2, 3, 5, 7, 9, 10),
    "phrygian": (0, 1, 3, 5, 7, 8, 10),
    "lydian": (0, 2, 4, 6, 7, 9, 11),
    "mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "harmonic minor": (0, 2, 3, 5, 7, 8, 11),
}

# One idiomatic four-chord loop per mode (scale degrees), chosen to show off its colour.
PROGRESSIONS: dict[str, tuple[int, ...]] = {
    "major": (0, 4, 5, 3),  # I-V-vi-IV
    "minor": (0, 5, 3, 6),  # i-VI-iv-VII
    "dorian": (0, 3, 0, 6),  # i-IV-i-VII: the bright IV
    "phrygian": (0, 1, 0, 6),  # i-bII-i-vii: the dark bII
    "lydian": (0, 1, 0, 4),  # I-II-I-V: the raised fourth in the II chord
    "mixolydian": (0, 6, 3, 0),  # I-bVII-IV-I
    "harmonic minor": (0, 3, 4, 0),  # i-iv-V-i with a true major V
}

# How each mode tends to feel, for AI composer prompts and the studio.
CHARACTER: dict[str, str] = {
    "major": "bright, heroic and optimistic",
    "minor": "serious, driven and a little melancholy",
    "dorian": "cool and adventurous; minor with a hopeful raised sixth",
    "phrygian": "dark, exotic and menacing, from the flattened second",
    "lydian": "dreamy, magical and floating, from the raised fourth",
    "mixolydian": "bluesy, playful and upbeat; major with a flattened seventh",
    "harmonic minor": "dramatic and villainous; minor with a leading tone",
}

KEYS = tuple(f"{tonic} {mode}" for mode in MODES for tonic in TONICS)
KEY_PATTERN = rf"^({'|'.join(TONICS)}) ({'|'.join(MODES)})$"


@dataclass(frozen=True)
class Key:
    name: str
    tonic: str
    mode: str
    scale: tuple[int, ...]
    root_midi: int
    """The tonic in the octave starting at C3 (MIDI 48), matching the original minor keys."""

    @property
    def progression(self) -> tuple[int, ...]:
        return PROGRESSIONS[self.mode]

    @property
    def character(self) -> str:
        return CHARACTER[self.mode]

    def pitch(self, degree: int, octave: int = 0) -> int:
        """MIDI pitch of a scale degree relative to the root, clamped to 0-127."""
        wraps, index = divmod(degree, len(self.scale))
        return max(0, min(127, self.root_midi + 12 * (octave + wraps) + self.scale[index]))

    def triad(self, degree: int, octave: int = 0) -> tuple[int, int, int]:
        """The diatonic triad built on a degree (stacked thirds within the scale)."""
        root, third, fifth = (self.pitch(degree + step, octave) for step in (0, 2, 4))
        return (root, third, fifth)

    def pitch_classes(self) -> set[int]:
        return {(self.root_midi + step) % 12 for step in self.scale}

    def note_names(self) -> str:
        """The scale spelled with one letter per degree (e.g. F# G# A B C# D E#)."""
        letters = "CDEFGAB"
        natural = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
        start = letters.index(self.tonic[0])
        names = []
        for degree, step in enumerate(self.scale):
            letter = letters[(start + degree) % 7]
            offset = (PITCH_CLASS[self.tonic] + step - natural[letter] + 6) % 12 - 6
            accidental = "#" * offset if offset > 0 else "b" * -offset
            names.append(letter + accidental)
        return " ".join(names)


def parse_key(name: str) -> Key:
    tonic, _, mode = name.strip().partition(" ")
    if tonic not in PITCH_CLASS or mode not in MODES:
        raise ValueError(f"Unknown key '{name}'. Use '<tonic> <mode>', e.g. 'C major'.")
    return Key(
        name=f"{tonic} {mode}",
        tonic=tonic,
        mode=mode,
        scale=MODES[mode],
        root_midi=48 + PITCH_CLASS[tonic],
    )
