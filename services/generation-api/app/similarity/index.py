"""The reference set, indexed by short phrase n-grams weighted by how rare they are.

A reference is a melody with a flag saying whether it is protected (a copyrighted song) or public
domain (folk tunes and the like, a "known safe" baseline). Titles and sources never leave the
index: check results name the user's clip and bars, not the matched song, so a warning can't be
used as a lookup service.
"""

from __future__ import annotations

import gzip
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from app.similarity.melody import Token

SEED = 4  # tokens per n-gram seed (six notes)
FORMAT = "synaptix-melody-index/1"


@dataclass(frozen=True)
class Reference:
    id: str
    protected: bool
    tokens: tuple[Token, ...]


@dataclass
class MelodyIndex:
    references: list[Reference]
    version: str = "unversioned"
    postings: dict[tuple[Token, ...], list[tuple[int, int]]] = field(default_factory=dict)
    weights: dict[tuple[Token, ...], float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.postings:
            return
        postings: dict[tuple[Token, ...], list[tuple[int, int]]] = defaultdict(list)
        for ref_number, reference in enumerate(self.references):
            for position in range(len(reference.tokens) - SEED + 1):
                postings[reference.tokens[position : position + SEED]].append(
                    (ref_number, position)
                )
        self.postings = dict(postings)
        total = max(1, len(self.references))
        for gram, hits in self.postings.items():
            songs = len({ref for ref, _ in hits})
            self.weights[gram] = math.log((1 + total) / (1 + songs)) + 1

    def save(self, path: Path) -> None:
        payload = {
            "format": FORMAT,
            "version": self.version,
            "references": [
                {"id": r.id, "protected": r.protected, "tokens": [list(t) for t in r.tokens]}
                for r in self.references
            ],
        }
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"))

    @classmethod
    def load(cls, path: Path) -> MelodyIndex:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)
        if payload.get("format") != FORMAT:
            raise ValueError(f"{path} isn't a {FORMAT} file.")
        references = [
            Reference(r["id"], bool(r["protected"]), tuple((a, b) for a, b in r["tokens"]))
            for r in payload["references"]
        ]
        return cls(references, version=payload.get("version", "unversioned"))
