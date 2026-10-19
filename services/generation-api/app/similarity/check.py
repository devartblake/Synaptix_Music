"""The melody check: does a melody line repeat a reference melody closely enough to block it?

The rule (publication-rules-v1, decision 4; thresholds to be calibrated on POP909 and known
infringement cases before the block is switched on):
- **Block:** 8 or more consecutive matching notes (interval and rhythm) against a protected song,
  or a rarity-weighted score at or above ``score_threshold`` when one is set.
- **Log only:** a run whose phrase also appears, at least as long, in a public-domain tune. That
  is a common phrase (a scale, a folk turn), not a copied hook.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from app.similarity.index import SEED, MelodyIndex
from app.similarity.melody import Token, notes_in_run

BLOCK_NOTES = 8


@dataclass(frozen=True)
class Match:
    start: int  # index of the first matching token in the query
    tokens: int  # consecutive matching tokens
    score: float  # sum of the rarity weights of the seeds in the run
    protected: bool  # False when the run is only in public-domain tunes, or common to one

    @property
    def notes(self) -> int:
        return notes_in_run(self.tokens)


def find_matches(tokens: list[Token], index: MelodyIndex) -> list[Match]:
    """Every exact run of matching tokens against a reference, found from shared n-gram seeds.

    Seeds that hit the same reference on the same diagonal (reference position minus query
    position) at consecutive query positions join into one run; k joined seeds span k + SEED - 1
    tokens.
    """
    hits: dict[tuple[int, int], list[tuple[int, float]]] = defaultdict(list)
    for position in range(len(tokens) - SEED + 1):
        gram = tuple(tokens[position : position + SEED])
        for ref_number, ref_position in index.postings.get(gram, ()):
            hits[(ref_number, ref_position - position)].append((position, index.weights[gram]))

    runs: list[tuple[int, int, int, float]] = []  # reference, start, tokens, score
    for (ref_number, _), seeds in hits.items():
        seeds.sort()
        start, previous, score = seeds[0][0], seeds[0][0], seeds[0][1]
        for position, weight in seeds[1:]:
            if position == previous + 1:
                previous, score = position, score + weight
                continue
            runs.append((ref_number, start, previous - start + SEED, score))
            start, previous, score = position, position, weight
        runs.append((ref_number, start, previous - start + SEED, score))

    common = [(s, n) for ref, s, n, _ in runs if not index.references[ref].protected]
    return [
        Match(
            start,
            length,
            score,
            index.references[ref].protected
            and not any(c <= start and start + length <= c + n for c, n in common),
        )
        for ref, start, length, score in runs
    ]


def is_block(match: Match, score_threshold: float | None = None) -> bool:
    if not match.protected:
        return False
    if match.notes >= BLOCK_NOTES:
        return True
    return score_threshold is not None and match.score >= score_threshold
