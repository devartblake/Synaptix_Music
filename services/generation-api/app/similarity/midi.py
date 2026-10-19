"""Reading reference melodies out of MIDI files (for building the index; needs ``mido``)."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from app.similarity.melody import Note, melody_line

DRUM_CHANNEL = 9
MIN_MELODY_NOTES = 16


def melody_from_midi(path: Path) -> list[Note]:
    """The file's most likely melody: of the pitched parts (track and channel) with enough notes,
    the one with the highest average pitch, reduced to its top line. A heuristic: reference sets
    such as Lakh MIDI don't label the melody track."""
    import mido

    parts: dict[tuple[int, int], list[Note]] = defaultdict(list)
    for track_number, track in enumerate(mido.MidiFile(path).tracks):
        tick = 0
        for message in track:
            tick += message.time
            if (
                message.type == "note_on"
                and message.velocity > 0
                and message.channel != DRUM_CHANNEL
            ):
                parts[(track_number, message.channel)].append(Note(message.note, tick))
    candidates = [notes for notes in parts.values() if len(notes) >= MIN_MELODY_NOTES]
    if not candidates:
        return []
    best = max(candidates, key=lambda notes: sum(n.pitch for n in notes) / len(notes))
    return melody_line(best)
