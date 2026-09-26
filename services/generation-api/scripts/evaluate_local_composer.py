"""Compares local models as arrangement composers.

Runs each model on a set of game briefs through the real LocalComposer (no
procedural fallback) and reports speed, how often it produced a usable plan,
and simple musical signals. Usage (with Ollama running):

    python scripts/evaluate_local_composer.py qwen2.5:7b llama3.1:8b
"""

import json
import statistics
import sys
import time

from app.generation.composers import LocalComposer
from app.models.generation import GenerationRequest

BRIEFS = [
    ("upbeat", 0.6, 0.5, "Upbeat trivia loop with a clear build and satisfying victory section"),
    ("tense", 0.85, 0.7, "Boss round: pulsing, urgent, countdown pressure, then a relieved win"),
    ("triumphant", 0.7, 0.4, "Bright celebratory theme for a leaderboard reveal"),
]


def evaluate(model: str, url: str) -> dict:
    composer = LocalComposer(base_url=url, model=model, timeout_seconds=300)
    runs = []
    for index, (mood, energy, complexity, brief) in enumerate(BRIEFS):
        request = GenerationRequest(
            projectId="eval",
            mood=mood,
            energy=energy,
            complexity=complexity,
            durationBars=16,
            seed=index + 1,
            brief=brief,
        )
        started = time.perf_counter()
        try:
            proposal = composer.compose(request)
            error = None
        except Exception as caught:  # noqa: BLE001 - evaluation records every failure
            proposal, error = None, str(caught)
        seconds = time.perf_counter() - started
        run = {"brief": brief, "seconds": round(seconds, 1), "ok": proposal is not None}
        if proposal:
            notes = {t.role: sum(len(c.notes) for c in t.clips) for t in proposal.tracks}
            run.update(
                sections=[f"{s.kind}:{s.bars}" for s in proposal.sections],
                notes=notes,
                warnings=proposal.warnings,
            )
        else:
            run["error"] = error
        runs.append(run)
        print(json.dumps({"model": model, **run}), flush=True)
    ok = [run for run in runs if run["ok"]]
    return {
        "model": model,
        "valid": f"{len(ok)}/{len(runs)}",
        "median_seconds": statistics.median(run["seconds"] for run in runs),
        "melody_notes": [run["notes"]["melody"] for run in ok],
        "runs": runs,
    }


def main() -> None:
    models = sys.argv[1:] or ["qwen2.5:7b"]
    url = "http://127.0.0.1:11434"
    summary = [evaluate(model, url) for model in models]
    print("\nSUMMARY")
    for result in summary:
        print(
            f"{result['model']}: valid {result['valid']}, median {result['median_seconds']} s, "
            f"melody notes {result['melody_notes']}"
        )


if __name__ == "__main__":
    main()
