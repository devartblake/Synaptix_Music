"""Build the melody check's reference index from folders of MIDI files.

    python scripts/build_melody_index.py --protected lakh-matched/ --public-domain essen/ \
        --version lakh-2026-10 --out melodies.json.gz

Protected folders hold copyrighted songs (matches block); public-domain folders hold the "known
safe" baseline (matches are only logged, and phrases shared with them never block). Point the
generation API at the result with SYNAPTIX_MELODY_INDEX. Which reference set to use is still a
decision (publication-rules-v1, decision 4); the index itself never leaves the server.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.similarity.index import MelodyIndex, Reference  # noqa: E402
from app.similarity.melody import phrase_tokens  # noqa: E402
from app.similarity.midi import melody_from_midi  # noqa: E402


def references(folder: Path, protected: bool) -> list[Reference]:
    found = []
    for path in sorted(folder.rglob("*.mid*")):
        try:
            tokens = phrase_tokens(melody_from_midi(path))
        except Exception as error:  # noqa: BLE001 - reference sets contain broken files
            print(f"skipped {path}: {error}", file=sys.stderr)
            continue
        if tokens:
            found.append(Reference(str(path.relative_to(folder)), protected, tuple(tokens)))
    return found


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--protected", type=Path, action="append", default=[])
    parser.add_argument("--public-domain", type=Path, action="append", default=[])
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    refs = [r for folder in args.protected for r in references(folder, True)]
    refs += [r for folder in args.public_domain for r in references(folder, False)]
    MelodyIndex(refs, version=args.version).save(args.out)
    protected = sum(r.protected for r in refs)
    print(f"{args.out}: {protected} protected and {len(refs) - protected} public-domain melodies")


if __name__ == "__main__":
    main()
