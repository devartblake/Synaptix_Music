"""Running the melody check over a generated arrangement."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from app.models.generation import (
    GeneratedMidiClip,
    GenerationProposal,
    SimilarityCheck,
    SimilarityFinding,
)
from app.similarity.check import find_matches, is_block
from app.similarity.index import MelodyIndex
from app.similarity.melody import Note, melody_line, phrase_tokens

BEATS_PER_BAR = 4  # generated arrangements are in 4/4


@lru_cache(maxsize=1)
def melody_index() -> MelodyIndex | None:
    """The reference index from SYNAPTIX_MELODY_INDEX, or None when none is configured."""
    path = os.environ.get("SYNAPTIX_MELODY_INDEX", "").strip()
    return MelodyIndex.load(Path(path)) if path else None


def score_threshold() -> float | None:
    value = os.environ.get("SYNAPTIX_MELODY_SCORE_THRESHOLD", "").strip()
    return float(value) if value else None


def check_proposal(
    proposal: GenerationProposal,
    index: MelodyIndex | None,
    threshold: float | None = None,
) -> SimilarityCheck:
    """Checks the top line of every pitched clip (drums are skipped)."""
    if index is None:
        return SimilarityCheck(status="unchecked")
    ticks_per_bar = proposal.ticksPerQuarterNote * BEATS_PER_BAR
    findings: list[SimilarityFinding] = []
    logged = 0
    for track in proposal.tracks:
        if track.role == "drums":
            continue
        for clip in track.clips:
            offset = _clip_start(clip, proposal.ticksPerQuarterNote)
            line = melody_line(
                Note(n.pitch, offset + n.startTick, n.durationTicks) for n in clip.notes
            )
            for match in find_matches(phrase_tokens(line), index):
                if is_block(match, threshold):
                    first, last = line[match.start], line[match.start + match.notes - 1]
                    findings.append(
                        SimilarityFinding(
                            trackId=track.id,
                            clipId=clip.id,
                            startBar=first.start // ticks_per_bar,
                            endBar=(last.start + last.duration - 1) // ticks_per_bar,
                            notes=match.notes,
                        )
                    )
                elif match.notes >= 6:
                    logged += 1
    return SimilarityCheck(
        status="blocked" if findings else "clear",
        indexVersion=index.version,
        findings=_merge(findings),
        loggedMatches=logged,
    )


def _clip_start(clip: GeneratedMidiClip, ticks_per_quarter: int) -> int:
    start = clip.range.start
    return (start.bar * BEATS_PER_BAR + start.beat) * ticks_per_quarter + start.tick


def _merge(findings: list[SimilarityFinding]) -> list[SimilarityFinding]:
    """One finding per clip stretch, however many references it matched."""
    merged: dict[tuple[str, str, int, int], SimilarityFinding] = {}
    for finding in findings:
        key = (finding.trackId, finding.clipId, finding.startBar, finding.endBar)
        if key not in merged or finding.notes > merged[key].notes:
            merged[key] = finding
    return sorted(merged.values(), key=lambda f: (f.trackId, f.clipId, f.startBar))
