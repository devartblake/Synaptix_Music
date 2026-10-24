"""The melody check: does a melody line repeat a reference melody closely enough to block it?

The rule (publication-rules-v1, decision 4), calibrated on POP909
(scripts/calibrate_melody_check.py; results in docs/plans/implementation/publication-rules-v1.md):
- **Block:** a run against a protected song that covers at least ``BLOCK_NOTES`` notes *and* carries
  at least ``block_bits`` bits of information. Counting notes alone flagged most unrelated pop songs
  and every generated arrangement: runs of repeated notes, scale steps and bass patterns are shared
  everywhere. Information (how rare each interval-and-rhythm step is across the reference set)
  separates a copied hook from a common figure.
- **Near copies count:** runs against the same song a changed or added note apart are joined, so a
  copy with an edited note is still one match.
- **Log only:** a run whose phrase also appears, at least as long, in a public-domain tune. That
  is a common phrase (a scale, a folk turn), not a copied hook.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from app.similarity.index import SEED, MelodyIndex
from app.similarity.melody import Token, notes_in_run

BLOCK_NOTES = 8
# On POP909: 2.5% of unrelated songs share a match this informative (about 1.6% without the set's
# duplicate songs), no generated arrangement came within 9 bits of it, and it catches 99.7% of
# exact 16-note copies, 80% with an edited note, and 62% of exact 12-note copies. Recalibrate it
# for the real reference set (SYNAPTIX_MELODY_BLOCK_BITS).
BLOCK_BITS = 56.0
# Exact runs this many tokens apart (a changed or an added note) are joined.
GAP = 2


@dataclass(frozen=True)
class Match:
    start: int  # index of the first matching token in the query
    tokens: int  # tokens the match spans in the query (gaps included)
    score: float  # sum of the rarity weights of the seeds in the match
    protected: bool  # False when the match is only in public-domain tunes, or common to one
    reference: int = -1  # position in the index (internal: results shown to people never name it)
    bits: float = 0.0  # information in the matching tokens

    @property
    def notes(self) -> int:
        return notes_in_run(self.tokens)


@dataclass
class _Run:
    reference: int
    diagonal: int
    start: int
    tokens: int
    score: float
    bits: float

    @property
    def end(self) -> int:
        return self.start + self.tokens


def find_matches(tokens: list[Token], index: MelodyIndex) -> list[Match]:
    """Matches against each reference, built from shared n-gram seeds.

    Seeds that hit the same reference on the same diagonal (reference position minus query
    position) at consecutive query positions form an exact run; k seeds span k + SEED - 1 tokens.
    Runs against the same reference at most ``GAP`` tokens apart, on the same diagonal or one off
    (an added or dropped note), are then joined into one match.
    """
    hits: dict[tuple[int, int], list[tuple[int, float]]] = defaultdict(list)
    for position in range(len(tokens) - SEED + 1):
        gram = tuple(tokens[position : position + SEED])
        for ref_number, ref_position in index.postings.get(gram, ()):
            hits[(ref_number, ref_position - position)].append((position, index.weights[gram]))

    runs: dict[int, list[_Run]] = defaultdict(list)
    for (ref_number, diagonal), seeds in hits.items():
        seeds.sort()
        start, previous, score = seeds[0][0], seeds[0][0], seeds[0][1]
        for position, weight in [*seeds[1:], (None, 0.0)]:
            if position is not None and position == previous + 1:
                previous, score = position, score + weight
                continue
            length = previous - start + SEED
            bits = index.information(tokens[start : start + length])
            runs[ref_number].append(_Run(ref_number, diagonal, start, length, score, bits))
            if position is not None:
                start, previous, score = position, position, weight

    joined: list[_Run] = []
    for ref_runs in runs.values():
        # Chains are kept per diagonal neighbourhood, so a stray run elsewhere in the song (melodies
        # repeat themselves) doesn't cut off the run on the far side of an edited note.
        chains: list[_Run] = []
        for run in sorted(ref_runs, key=lambda r: (r.start, r.diagonal)):
            for i, chain in enumerate(chains):
                gap = run.start - chain.end
                if (
                    -SEED < gap <= GAP
                    and abs(run.diagonal - chain.diagonal) <= 1
                    and run.end > chain.end
                ):
                    overlap = max(0, chain.end - run.start)
                    extra = index.information(tokens[run.start + overlap : run.end])
                    chains[i] = _Run(
                        chain.reference,
                        run.diagonal,
                        chain.start,
                        run.end - chain.start,
                        chain.score + run.score,
                        chain.bits + extra,
                    )
                    break
            else:
                chains.append(run)
        joined.extend(chains)

    common = [(r.start, r.tokens) for r in joined if not index.references[r.reference].protected]
    return [
        Match(
            r.start,
            r.tokens,
            r.score,
            index.references[r.reference].protected
            and not any(c <= r.start and r.end <= c + n for c, n in common),
            r.reference,
            r.bits,
        )
        for r in joined
    ]


def is_block(match: Match, block_bits: float = BLOCK_BITS) -> bool:
    return match.protected and match.notes >= BLOCK_NOTES and match.bits >= block_bits
