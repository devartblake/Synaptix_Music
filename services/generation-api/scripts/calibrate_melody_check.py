"""Calibrate the melody check on POP909 (909 pop songs with labelled melody tracks; MIT licence).

    python scripts/calibrate_melody_check.py <POP909 folder> [--generated 200] [--out report.md]

POP909 is a calibration set, not the reference set: it's small, but its MELODY tracks are clean
and labelled, and each song has alternative transcriptions in versions/. Measured:

A. Melody extraction: how often midi.melody_from_midi picks the labelled MELODY track, with the
   track names removed so it can't read the label.
B. False positives: each song's longest run against the other 908 (unrelated songs). Different
   songs sharing a run of N notes is what a block at N would wrongly flag.
C. Recall: excerpts of each song, transposed, re-timed and lightly edited, against their own song.
D. Re-transcriptions: each versions/ file against its own song (a realistic near copy).
E. Generated music: procedural arrangements against all 909 songs (should almost never block).

The songs are copyrighted: keep the dataset out of the repository.
"""

from __future__ import annotations

import argparse
import random
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.generation.composers import ProceduralComposer, compose_arrangement  # noqa: E402
from app.models.generation import GenerationRequest  # noqa: E402
from app.similarity.check import BLOCK_BITS, BLOCK_NOTES, find_matches  # noqa: E402
from app.similarity.index import MelodyIndex, Reference  # noqa: E402
from app.similarity.melody import Note, melody_line, phrase_tokens  # noqa: E402
from app.similarity.midi import melody_from_midi  # noqa: E402

BIT_THRESHOLDS = [36, 40, 44, 48, 52, 56, 60, 70]


def labelled_melody(path: Path) -> list[Note]:
    import mido

    notes = []
    for track in mido.MidiFile(path).tracks:
        if track.name.strip().upper() != "MELODY":
            continue
        tick = 0
        for message in track:
            tick += message.time
            if message.type == "note_on" and message.velocity > 0:
                notes.append(Note(message.note, tick))
    return melody_line(notes)


def unnamed(path: Path, scratch: Path) -> Path:
    """A copy of the file with its track names removed, so extraction can't read the label."""
    import mido

    midi = mido.MidiFile(path)
    for track in midi.tracks:
        track.name = ""
    copy = scratch / "unnamed.mid"
    midi.save(copy)
    return copy


def strongest(
    tokens, index: MelodyIndex, *, only: int | None = None, skip: int | None = None
) -> float:
    """The most informative match of at least BLOCK_NOTES notes, in bits (0 when none)."""
    bits = [
        m.bits
        for m in find_matches(tokens, index)
        if m.notes >= BLOCK_NOTES and (only is None or m.reference == only) and m.reference != skip
    ]
    return max(bits, default=0.0)


def rate(values: list[float], threshold: float) -> float:
    return sum(v >= threshold for v in values) / max(1, len(values))


def transform(line: list[Note], kind: str, rng: random.Random) -> list[Note]:
    if kind == "exact":
        return line
    if kind == "transposed":
        shift = rng.choice([-7, -5, -3, -2, 2, 3, 5, 7])
        return [Note(n.pitch + shift, n.start) for n in line]
    if kind == "tempo x1.5":
        return [Note(n.pitch, int(n.start * 1.5)) for n in line]
    if kind == "one note changed":
        i = rng.randrange(1, len(line) - 1)
        return [Note(n.pitch + (2 if j == i else 0), n.start) for j, n in enumerate(line)]
    if kind == "one note added":
        i = rng.randrange(1, len(line) - 1)
        mid = (line[i - 1].start + line[i].start) // 2
        return line[:i] + [Note(line[i - 1].pitch + 1, mid)] + line[i:]
    raise ValueError(kind)


TRANSFORMS = ["exact", "transposed", "tempo x1.5", "one note changed", "one note added"]


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("pop909", type=Path)
    parser.add_argument("--generated", type=int, default=200)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    rng = random.Random(909)
    songs = sorted(
        p for p in args.pop909.iterdir() if p.is_dir() and (p / f"{p.name}.mid").exists()
    )

    # A. Extraction, and the index of labelled melodies.
    lines, picked_right = {}, 0
    for song in songs:
        line = labelled_melody(song / f"{song.name}.mid")
        lines[song.name] = line
        heuristic = melody_from_midi(unnamed(song / f"{song.name}.mid", args.pop909.parent))
        picked_right += [n.pitch for n in heuristic[:50]] == [n.pitch for n in line[:50]]
    names = list(lines)
    index = MelodyIndex(
        [Reference(name, True, tuple(phrase_tokens(lines[name]))) for name in names],
        version="pop909",
    )
    position = {name: i for i, name in enumerate(names)}

    # B. False positives: each song against the others.
    negatives = [strongest(phrase_tokens(lines[n]), index, skip=position[n]) for n in names]

    # C. Recall on excerpts.
    recall: dict[tuple[str, int], list[int]] = {}
    for length in (8, 10, 12, 16):
        for name in names:
            line = lines[name]
            if len(line) < length + 2:
                continue
            start = rng.randrange(0, len(line) - length)
            excerpt = line[start : start + length]
            for kind in TRANSFORMS:
                query = phrase_tokens(transform(excerpt, kind, rng))
                recall.setdefault((kind, length), []).append(
                    strongest(query, index, only=position[name])
                )

    # D. Re-transcriptions in versions/.
    versions = []
    for song in songs:
        for path in sorted((song / "versions").glob("*.mid")):
            line = labelled_melody(path)
            if len(line) > 10:
                versions.append(strongest(phrase_tokens(line), index, only=position[song.name]))

    # E. Generated music.
    generated = []
    moods, keys = (
        ["upbeat", "tense", "triumphant"],
        ["C major", "A minor", "D minor", "E phrygian", "G mixolydian"],
    )
    for seed in range(args.generated):
        request = GenerationRequest(
            projectId=f"cal-{seed}",
            seed=seed,
            mood=moods[seed % 3],
            key=keys[seed % len(keys)],
            tempo=90 + seed % 50,
        )
        proposal = compose_arrangement(request, ProceduralComposer())
        worst = 0.0
        for track in proposal.tracks:
            if track.role == "drums":
                continue
            for clip in track.clips:
                line = melody_line(Note(n.pitch, n.startTick) for n in clip.notes)
                worst = max(worst, strongest(phrase_tokens(line), index))
        generated.append(worst)

    report = render(len(songs), picked_right, negatives, recall, versions, generated)
    print(report)
    if args.out:
        args.out.write_text(report)


def render(songs, picked_right, negatives, recall, versions, generated) -> str:
    out = [f"# Melody check calibration on POP909 ({songs} songs)\n"]
    out.append(
        f"**A. Melody extraction:** the heuristic picked the labelled melody for "
        f"{picked_right}/{songs} songs ({picked_right / songs:.0%}).\n"
    )
    out.append(
        f"**B–E by information threshold** (share of cases with a match of at least "
        f"{BLOCK_NOTES} notes carrying at least N bits; the current rule is {BLOCK_BITS:g} bits):\n"
    )
    out += [
        "| N bits | " + " | ".join(str(t) for t in BIT_THRESHOLDS) + " |",
        "|" + " --- |" * (len(BIT_THRESHOLDS) + 1),
    ]

    def row(label, values):
        return f"| {label} | " + " | ".join(f"{rate(values, t):.1%}" for t in BIT_THRESHOLDS) + " |"

    out.append(row("B. unrelated songs (false positives)", negatives))
    ordered = sorted(recall.items(), key=lambda kv: (kv[0][1], TRANSFORMS.index(kv[0][0])))
    for (kind, length), values in ordered:
        out.append(row(f"C. {length}-note excerpt, {kind}", values))
    out.append(row(f"D. re-transcriptions ({len(versions)})", versions))
    out.append(row(f"E. generated arrangements ({len(generated)})", generated))
    out.append("")
    likely_duplicates = sum(v > 90 for v in negatives)
    out.append(
        f"Strongest match between unrelated songs: median {statistics.median(negatives):.1f} bits; "
        f"{likely_duplicates} songs match another above 90 bits (likely the same song twice in "
        f"POP909). Generated arrangements: median {statistics.median(generated):.1f}, "
        f"max {max(generated):.1f} bits."
    )
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    main()
