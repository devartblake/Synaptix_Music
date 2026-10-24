"""Reading reference melodies out of MIDI files (for building the index; needs ``mido``)."""

from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path

from app.similarity.melody import Note, melody_line

DRUM_CHANNEL = 9
MIN_MELODY_NOTES = 16


MELODY_NAMES = ("melody", "vocal", "voice", "lead", "sing")


def melody_from_midi(path: Path) -> list[Note]:
    """The file's most likely melody, reduced to its top line.

    A part (track and channel) named like a melody wins. Otherwise it's the most monophonic pitched
    part with enough notes (ties go to the higher one): melodies are sung one note at a time, while
    accompaniment plays chords. On POP909 with its track names ignored, this picks the labelled
    melody 85% of the time; "the highest part" managed 40% (scripts/calibrate_melody_check.py).
    """
    import mido

    parts: dict[tuple[int, int], list[Note]] = defaultdict(list)
    names: dict[tuple[int, int], str] = {}
    for track_number, track in enumerate(mido.MidiFile(path).tracks):
        tick = 0
        for message in track:
            tick += message.time
            if (
                message.type == "note_on"
                and message.velocity > 0
                and message.channel != DRUM_CHANNEL
            ):
                key = (track_number, message.channel)
                parts[key].append(Note(message.note, tick))
                names[key] = track.name.lower()
    candidates = {key: notes for key, notes in parts.items() if len(notes) >= MIN_MELODY_NOTES}
    if not candidates:
        return []
    named = [key for key in candidates if any(word in names[key] for word in MELODY_NAMES)]
    if named:
        return melody_line(max((candidates[k] for k in named), key=len))

    def monophony(notes: list[Note]) -> float:
        onsets = Counter(note.start for note in notes)
        return sum(1 for count in onsets.values() if count == 1) / len(onsets)

    best = max(
        candidates.values(),
        key=lambda notes: (round(monophony(notes), 2), sum(n.pitch for n in notes) / len(notes)),
    )
    return melody_line(best)
