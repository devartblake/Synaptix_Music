import pytest
from pydantic import ValidationError

from app.generation.plan import ArrangementPlan, render_plan
from app.generation.procedural import generate_arrangement
from app.generation.theory import KEYS, MODES, PROGRESSIONS, parse_key
from app.models.generation import GenerationRequest

MELODY = [
    {"step": step, "degree": degree, "length": 2}
    for step, degree in zip(range(0, 16, 2), range(-7, 14, 3), strict=False)
]
MODE_KEYS = [f"{tonic} {mode}" for mode in MODES for tonic in ("C", "F#", "Bb")]


def request(key: str, **overrides) -> GenerationRequest:
    return GenerationRequest(projectId="p", key=key, **overrides)


def test_every_tonic_and_mode_is_a_valid_request_key() -> None:
    assert len(KEYS) == 12 * 7
    for key in KEYS:
        assert request(key).key == key


@pytest.mark.parametrize("key", ["D minor", "A minor", "C minor"])
def test_original_minor_keys_keep_their_roots(key: str) -> None:
    assert parse_key(key).root_midi == {"C minor": 48, "D minor": 50, "A minor": 57}[key]


@pytest.mark.parametrize("key", ["H major", "C", "C Major", "C locrian", "D  minor", ""])
def test_unknown_keys_are_rejected(key: str) -> None:
    with pytest.raises(ValidationError):
        request(key)


def test_modes_have_their_defining_intervals() -> None:
    assert parse_key("C major").triad(0) == (48, 52, 55)  # major I
    assert parse_key("C minor").triad(0) == (48, 51, 55)  # minor i
    assert parse_key("D dorian").triad(3) == (55, 59, 62)  # major IV (G B D)
    assert parse_key("E phrygian").triad(1) == (53, 57, 60)  # major bII (F A C)
    assert parse_key("F lydian").triad(1) == (55, 59, 62)  # major II (G B D)
    assert parse_key("G mixolydian").triad(6) == (65, 69, 72)  # major bVII (F A C)
    assert parse_key("A harmonic minor").triad(4) == (64, 68, 71)  # major V (E G# B)


def test_scales_are_spelled_with_one_letter_per_degree() -> None:
    assert parse_key("F# harmonic minor").note_names() == "F# G# A B C# D E#"
    assert parse_key("Eb minor").note_names() == "Eb F Gb Ab Bb Cb Db"


def test_every_mode_has_a_progression_starting_on_the_tonic() -> None:
    assert set(PROGRESSIONS) == set(MODES)
    assert all(progression[0] == 0 for progression in PROGRESSIONS.values())


@pytest.mark.parametrize("key", MODE_KEYS)
def test_procedural_arrangements_stay_in_key_in_every_mode(key: str) -> None:
    scale = parse_key(key).pitch_classes()
    proposal = generate_arrangement(request(key, seed=7, energy=0.9, complexity=0.9))
    for track in proposal.tracks:
        if track.role == "drums":
            continue
        for note in track.clips[0].notes:
            assert note.pitch % 12 in scale, (key, track.role, note.pitch)


@pytest.mark.parametrize("key", MODE_KEYS)
def test_ai_plans_render_in_key_in_every_mode(key: str) -> None:
    plan = ArrangementPlan.model_validate(
        {
            "title": "Mode check",
            "sections": [
                {
                    "kind": kind,
                    "name": kind,
                    "bars": 4,
                    "energy": 0.7,
                    "chords": [0, 1, 2, 3, 4, 5, 6],
                    "harmony": "arpeggio",
                    "bass": "x.o.x.o.x.o.x.o.",
                    "drums": {"kick": "x...x...", "snare": "....x...", "hat": "x.x.x.x."},
                    "melody": [MELODY],
                }
                for kind in ("intro", "main", "victory")
            ],
        }
    )
    scale = parse_key(key).pitch_classes()
    proposal = render_plan(
        request(key), plan, generator_id="synaptix-local-composer", generator_version="1"
    )
    for track in proposal.tracks:
        if track.role != "drums":
            pitches = {note.pitch % 12 for note in track.clips[0].notes}
            assert pitches <= scale, (key, track.role)


def test_major_and_minor_arrangements_differ() -> None:
    major = generate_arrangement(request("C major", seed=3))
    minor = generate_arrangement(request("C minor", seed=3))
    harmony = lambda proposal: [n.pitch for n in proposal.tracks[2].clips[0].notes]  # noqa: E731
    assert harmony(major) != harmony(minor)
