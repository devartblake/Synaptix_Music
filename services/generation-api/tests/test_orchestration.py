import re
from pathlib import Path

import pytest

from app.generation.orchestration import (
    INSTRUMENTS,
    ROLE_INSTRUMENTS,
    ROLE_MIX,
    ROLES,
    TICKS_PER_BAR,
    choose_ensemble,
)
from app.generation.plan import ArrangementPlan, render_plan
from app.generation.procedural import generate_arrangement
from app.generation.theory import parse_key
from app.models.generation import GenerationRequest

CATALOG = Path(__file__).resolve().parents[3] / "packages/daw-engine/src/instrument-catalog.ts"


def request(**overrides) -> GenerationRequest:
    values = {"projectId": "p", "seed": 4}
    values.update(overrides)
    return GenerationRequest(**values)


def test_instruments_match_the_studio_catalog() -> None:
    studio = set(re.findall(r'deviceType: "([a-z0-9-]+)"', CATALOG.read_text(encoding="utf-8")))
    assert set(INSTRUMENTS) == studio


def test_every_role_has_suitable_instruments_and_a_mix() -> None:
    for role in ROLES:
        assert ROLE_INSTRUMENTS[role] and set(ROLE_INSTRUMENTS[role]) <= set(INSTRUMENTS)
        assert role in ROLE_MIX


# Riser and Downsweep FX are one-shot transitions with no musical part to play, so no role
# offers them.
TRANSITION_FX = {"synaptix-riser", "synaptix-downsweep"}


def test_every_playable_catalog_instrument_is_offered_by_some_role() -> None:
    offered = {instrument for options in ROLE_INSTRUMENTS.values() for instrument in options}
    assert offered == set(INSTRUMENTS) - TRANSITION_FX


def test_role_defaults_stay_put_as_instruments_are_added() -> None:
    # Plans that ask for no particular instrument must keep sounding the same.
    defaults = {role: options[0] for role, options in ROLE_INSTRUMENTS.items()}
    assert defaults == {
        "drums": "synaptix-drum-synth",
        "bass": "synaptix-bass-synth",
        "sub-bass": "synaptix-sub-bass",
        "harmony": "synaptix-poly-synth",
        "pad": "synaptix-pad",
        "arpeggio": "synaptix-pluck",
        "melody": "synaptix-lead-synth",
        "countermelody": "synaptix-strings",
        "stabs": "synaptix-brass",
        "sparkle": "synaptix-bell",
    }


@pytest.mark.parametrize(
    ("key", "mood", "energy", "complexity", "expected"),
    [
        ("C major", "upbeat", 0.8, 0.6, {"melody": "synaptix-organ", "arpeggio": "synaptix-pluck"}),
        (
            "A harmonic minor",
            "tense",
            0.85,
            0.75,
            {"stabs": "synaptix-brass", "sub-bass": "synaptix-sub-bass"},
        ),
        (
            "D minor",
            "triumphant",
            0.8,
            0.5,
            {"melody": "synaptix-brass", "harmony": "synaptix-strings"},
        ),
        (
            "D dorian",
            "upbeat",
            0.5,
            0.3,
            {"harmony": "synaptix-electric-piano", "pad": "synaptix-pad"},
        ),
    ],
)
def test_ensembles_follow_mood_and_mode(key, mood, energy, complexity, expected) -> None:
    ensemble = choose_ensemble(parse_key(key), mood, energy, complexity)
    assert expected.items() <= ensemble.items()
    assert all(instrument in ROLE_INSTRUMENTS[role] for role, instrument in ensemble.items())


def test_procedural_layers_play_only_in_their_sections() -> None:
    proposal = generate_arrangement(
        request(key="A harmonic minor", mood="tense", energy=0.85, complexity=0.75)
    )
    kind_of_bar = {
        bar: section.kind
        for section in proposal.sections
        for bar in range(section.startBar, section.startBar + section.bars)
    }
    stabs = next(track for track in proposal.tracks if track.role == "stabs")
    assert stabs.clips[0].notes
    assert {kind_of_bar[note.startTick // TICKS_PER_BAR] for note in stabs.clips[0].notes} <= {
        "tension",
        "victory",
    }


def test_generated_tracks_carry_catalog_instruments_and_mix_hints() -> None:
    proposal = generate_arrangement(
        request(key="C major", mood="triumphant", energy=0.8, complexity=0.8)
    )
    assert len(proposal.tracks) > 4
    for track in proposal.tracks:
        assert track.instrumentId in INSTRUMENTS
        assert track.volumeDb == ROLE_MIX[track.role].volume_db
        assert track.clips[0].notes


def test_layers_stay_in_key() -> None:
    key = "E phrygian"
    proposal = generate_arrangement(request(key=key, mood="tense", energy=0.9, complexity=0.9))
    scale = parse_key(key).pitch_classes()
    for track in proposal.tracks:
        if track.role != "drums":
            assert {note.pitch % 12 for note in track.clips[0].notes} <= scale, track.role


def plan(**extra) -> ArrangementPlan:
    section = {
        "bars": 4,
        "energy": 0.7,
        "chords": [0, 3, 4, 0],
        "harmony": "stabs",
        "bass": "x.x.x.x.x.x.x.x.",
        "drums": {"kick": "x...", "snare": "..x.", "hat": "xxxx"},
        "melody": [[{"step": 0, "degree": 4, "length": 4}]],
    }
    return ArrangementPlan.model_validate(
        {
            "title": "Plan",
            "sections": [
                {**section, "kind": kind, "name": kind, **extra.get(kind, {})}
                for kind in ("intro", "main", "victory")
            ],
            "ensemble": extra.get("ensemble", []),
        }
    )


def render(p: ArrangementPlan):
    return render_plan(
        request(key="C major"), p, generator_id="synaptix-claude-composer", generator_version="1"
    )


def test_plans_without_an_ensemble_keep_the_four_core_parts() -> None:
    proposal = render(plan())
    assert [track.role for track in proposal.tracks] == ["drums", "bass", "harmony", "melody"]


def test_plan_ensembles_choose_instruments_and_section_layers() -> None:
    proposal = render(
        plan(
            ensemble=[
                {"role": "melody", "instrument": "synaptix-organ"},
                {"role": "sparkle", "instrument": "synaptix-bell"},
                {"role": "stabs", "instrument": "synaptix-brass"},
                {"role": "pad", "instrument": "synaptix-drum-synth"},  # unsuitable: default instead
                {"role": "kazoo", "instrument": "synaptix-bell"},  # unknown role: ignored
            ],
            intro={"layers": ["pad", "sparkle"]},
            main={"layers": []},
            victory={"layers": ["stabs"]},
        )
    )
    tracks = {track.role: track for track in proposal.tracks}
    assert tracks["melody"].instrumentId == "synaptix-organ"
    assert tracks["pad"].instrumentId == "synaptix-pad"
    assert "kazoo" not in tracks
    victory_start = proposal.sections[2].startBar * TICKS_PER_BAR
    main = proposal.sections[1]
    assert all(note.startTick >= victory_start for note in tracks["stabs"].clips[0].notes)
    assert not any(
        main.startBar * TICKS_PER_BAR
        <= note.startTick
        < (main.startBar + main.bars) * TICKS_PER_BAR
        for note in tracks["sparkle"].clips[0].notes
    )


def test_tempo_range_allows_up_tempo_game_music() -> None:
    assert request(tempo=180).tempo == 180
    assert request(tempo=60).tempo == 60
    with pytest.raises(ValueError):
        request(tempo=201)
