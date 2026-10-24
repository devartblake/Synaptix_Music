"""The melody check (publication-rules-v1, decision 4).

What the rule protects against: generated music repeating a copyrighted song's hook. So a match must
survive a change of key and tempo and an edited note; fewer than 8 notes never block; a run with
little information (repeated notes, a scale) doesn't block however long it is, because unrelated
songs share those; a phrase also in a public-domain tune is only logged; and a warning never names
the song. Thresholds come from the POP909 calibration (scripts/calibrate_melody_check.py).

The "protected" melodies here are invented stand-ins; the repository ships no copyrighted melodies.
"""

import random
from pathlib import Path

from app.generation.composers import ProceduralComposer, compose_arrangement
from app.models.generation import GenerationRequest
from app.similarity.check import BLOCK_BITS, find_matches, is_block
from app.similarity.index import MelodyIndex, Reference
from app.similarity.melody import Note, melody_line, phrase_tokens
from app.similarity.proposal import check_proposal

Q = 960  # ticks per quarter note


def line(pitches: list[int], beats: list[float], start: int = 0, scale: float = 1.0) -> list[Note]:
    notes, tick = [], start
    for pitch, length in zip(pitches, beats, strict=True):
        duration = int(length * Q * scale)
        notes.append(Note(pitch, tick, duration))
        tick += duration
    return notes


# Invented "protected" hook: distinctive leaps and rhythm.
HOOK_PITCHES = [64, 71, 69, 74, 72, 67, 76, 74, 79, 77, 72, 81, 76, 83, 78, 71]
HOOK_BEATS = [
    0.5,
    0.25,
    0.75,
    0.5,
    0.25,
    1.0,
    0.5,
    0.25,
    0.75,
    0.5,
    0.25,
    1.0,
    0.5,
    0.25,
    0.75,
    1.0,
]
# Repeated notes in an even rhythm: in real songs this is everywhere.
REPEATED = [67] * 16
# Public domain: "Ode to Joy" opening, and a plain major scale run.
ODE = line([64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62], [1] * 12 + [1.5, 0.5, 2])
SCALE = line([60, 62, 64, 65, 67, 69, 71, 72, 74, 76], [0.5] * 10)


def reference(ref_id: str, notes: list[Note], protected: bool) -> Reference:
    return Reference(ref_id, protected, tuple(phrase_tokens(melody_line(notes))))


def index(*extra: Reference) -> MelodyIndex:
    rng = random.Random(1)
    filler = [  # unrelated protected songs, so phrase statistics behave as in a real set
        reference(
            f"filler-{i}",
            # Like real melodies, they mix leaps with stretches of repeated notes.
            line(
                [rng.randint(55, 80) for _ in range(24)] + [60 + i] * 12,
                [rng.choice([0.5, 1]) for _ in range(24)] + [0.5] * 12,
            ),
            True,
        )
        for i in range(20)
    ]
    return MelodyIndex(
        [
            reference("hook", line(HOOK_PITCHES, HOOK_BEATS), True),
            reference("ode", ODE, False),
            *filler,
            *extra,
        ],
        version="test",
    )


def tokens_of(notes: list[Note]):
    return phrase_tokens(melody_line(notes))


def longest_blocking(notes: list[Note], idx: MelodyIndex, block_bits: float = BLOCK_BITS) -> int:
    matches = find_matches(tokens_of(notes), idx)
    return max((m.notes for m in matches if is_block(m, block_bits)), default=0)


def test_a_copied_hook_is_found_in_another_key_and_tempo() -> None:
    copied = line([p + 5 for p in HOOK_PITCHES], HOOK_BEATS, start=7 * Q, scale=2.0)
    assert longest_blocking(copied, index()) == len(HOOK_PITCHES)


def test_fewer_than_eight_notes_never_block_however_distinctive() -> None:
    idx = index()
    tail = [50, 52, 49]  # unrelated notes after the copied stretch
    eight = line(HOOK_PITCHES[:8] + tail, HOOK_BEATS[:8] + [1, 1, 1])
    seven = line(HOOK_PITCHES[:7] + tail, HOOK_BEATS[:7] + [1, 1, 1])
    # With the information bar removed, length alone decides.
    assert longest_blocking(eight, idx, block_bits=0) >= 8
    assert longest_blocking(seven, idx, block_bits=0) == 0


def test_a_long_run_of_repeated_notes_does_not_block() -> None:
    # Sixteen repeated notes match every filler song's repeated stretch, but carry little
    # information: on POP909, counting notes like this flagged most unrelated songs.
    matches = find_matches(tokens_of(line(REPEATED, [0.5] * 16)), index())
    assert any(m.notes >= 8 for m in matches)
    assert not any(is_block(m) for m in matches)


def test_a_copy_with_one_edited_note_still_blocks() -> None:
    edited = list(HOOK_PITCHES)
    edited[8] += 2
    assert longest_blocking(line(edited, HOOK_BEATS), index()) >= 14


def test_matches_only_against_public_domain_tunes_are_logged_not_blocked() -> None:
    matches = find_matches(tokens_of(ODE), index())
    assert matches and not any(is_block(m) for m in matches)


def test_a_common_phrase_shared_with_a_public_domain_tune_does_not_block() -> None:
    # A protected song that happens to contain a plain scale run, as many do.
    protected_with_scale = reference(
        "pop-with-scale", SCALE + line([80, 70, 75], [1, 1, 1], start=5 * Q), True
    )
    public_scale = reference("folk-scale", SCALE, False)
    # The information bar is lifted to isolate the public-domain rule.
    assert longest_blocking(SCALE, index(protected_with_scale), block_bits=0) >= 8
    assert longest_blocking(SCALE, index(protected_with_scale, public_scale), block_bits=0) == 0


def test_the_top_line_is_the_melody() -> None:
    chord_under_melody = [Note(48, 0), Note(52, 0), Note(67, 0), Note(48, Q), Note(69, Q)]
    assert [n.pitch for n in melody_line(chord_under_melody)] == [67, 69]


def test_an_index_round_trips_through_its_file(tmp_path: Path) -> None:
    original = index()
    path = tmp_path / "melodies.json.gz"
    original.save(path)
    loaded = MelodyIndex.load(path)
    assert loaded.version == "test"
    assert loaded.references == original.references


def test_a_proposal_reports_where_not_what_and_is_unchecked_without_an_index() -> None:
    proposal = compose_arrangement(GenerationRequest(projectId="p", seed=3), ProceduralComposer())
    assert proposal.similarityCheck is not None
    assert proposal.similarityCheck.status == "unchecked"  # no SYNAPTIX_MELODY_INDEX in tests

    # Plant the hook in the melody track's first clip, in bars 2-3.
    melody = next(t for t in proposal.tracks if t.role == "melody")
    clip = melody.clips[0]
    planted = line(HOOK_PITCHES, HOOK_BEATS, start=2 * 4 * Q)
    clip.notes = [
        n.model_copy(
            update={
                "pitch": p.pitch,
                "startTick": p.start - clip.range.start.bar * 4 * Q,
                "durationTicks": p.duration,
            }
        )
        for n, p in zip(clip.notes, planted, strict=False)
    ]
    result = check_proposal(proposal, index())
    assert result.status == "blocked"
    finding = next(f for f in result.findings if f.clipId == clip.id)
    assert finding.trackId == melody.id
    assert "hook" not in result.model_dump_json()  # the matched song is never named


def _midi(tmp_path: Path, parts, names=None) -> Path:
    mido = __import__("pytest").importorskip("mido")
    song = mido.MidiFile(ticks_per_beat=Q)
    for number, (channel, chords) in enumerate(parts):
        track = mido.MidiTrack()
        track.name = (names or {}).get(number, "")
        for chord in chords:
            for pitch in chord:
                track.append(
                    mido.Message("note_on", note=pitch, velocity=90, channel=channel, time=0)
                )
            for i, pitch in enumerate(chord):
                track.append(
                    mido.Message(
                        "note_off",
                        note=pitch,
                        velocity=0,
                        channel=channel,
                        time=Q // 2 if i == 0 else 0,
                    )
                )
        song.tracks.append(track)
    path = tmp_path / "song.mid"
    song.save(path)
    return path


def test_the_index_builder_finds_the_melody_part_of_a_midi_file(tmp_path: Path) -> None:
    from app.similarity.midi import melody_from_midi

    melody = [[p] for p in HOOK_PITCHES + HOOK_PITCHES[:4]]
    piano = [[72, 79, 84]] * 20  # chords played above the melody
    bass, drums = [[40]] * 20, [[36]] * 20
    path = _midi(tmp_path, [(0, bass), (1, melody), (2, piano), (9, drums)])
    # Melodies are sung one note at a time: the chordal piano is higher but isn't the tune.
    assert [n.pitch for n in melody_from_midi(path)][:16] == HOOK_PITCHES
    # A part named like a melody wins outright.
    named = _midi(tmp_path, [(0, bass), (1, piano)], names={0: "Lead vocal"})
    assert {n.pitch for n in melody_from_midi(named)} == {40}
