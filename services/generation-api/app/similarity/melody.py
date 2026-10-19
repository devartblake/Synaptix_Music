"""Melody lines and the key- and tempo-independent phrase tokens they are compared by."""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass

Token = tuple[int, int]


@dataclass(frozen=True)
class Note:
    pitch: int
    start: int  # ticks; only differences matter, so any resolution works
    duration: int = 1


def melody_line(notes: Iterable[Note]) -> list[Note]:
    """The top line: the highest pitch at each onset (the "skyline"), in time order."""
    top: dict[int, Note] = {}
    for note in notes:
        current = top.get(note.start)
        if current is None or note.pitch > current.pitch:
            top[note.start] = note
    return [top[start] for start in sorted(top)]


def phrase_tokens(line: list[Note]) -> list[Token]:
    """One token per note from the third on: (interval from the previous note, rhythm).

    The interval (in semitones, clamped to two octaves) makes the comparison key-independent. The
    rhythm is the ratio of this note's onset gap to the previous one, on a half-octave log scale,
    so it is tempo-independent and survives notating a tune in doubled or halved values. A token
    therefore spans three notes, and N consecutive matching tokens mean N + 2 matching notes.
    """
    tokens: list[Token] = []
    for i in range(2, len(line)):
        gap, previous_gap = line[i].start - line[i - 1].start, line[i - 1].start - line[i - 2].start
        if gap <= 0 or previous_gap <= 0:
            continue
        interval = max(-24, min(24, line[i].pitch - line[i - 1].pitch))
        rhythm = max(-4, min(4, round(2 * math.log2(gap / previous_gap))))
        tokens.append((interval, rhythm))
    return tokens


def notes_in_run(tokens: int) -> int:
    """How many notes a run of consecutive matching tokens covers."""
    return tokens + 2 if tokens else 0
