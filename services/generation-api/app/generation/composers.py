"""Composer providers, selected per environment with SYNAPTIX_COMPOSER.

- ``procedural`` (default): the deterministic rule-based composer.
- ``claude``: Claude writes an ArrangementPlan that ``render_plan`` turns into notes.
- ``local``: an open-weight model on the local GPU (added in a later increment).

An AI composer that fails for any reason falls back to the procedural composer,
and the proposal carries a warning saying so, so generation never breaks.
"""

import logging
import os
from collections.abc import Mapping
from typing import Any, Protocol

from app.generation.plan import ArrangementPlan, render_plan
from app.generation.procedural import generate_arrangement
from app.models.generation import GenerationProposal, GenerationRequest

logger = logging.getLogger(__name__)

CLAUDE_COMPOSER_VERSION = "1.0.0"
DEFAULT_CLAUDE_MODEL = "claude-opus-5"
LOCAL_COMPOSER_VERSION = "1.0.0"
DEFAULT_LOCAL_MODEL = "qwen2.5:7b"
DEFAULT_LOCAL_MODEL_URL = "http://ollama:11434"


class ComposerError(RuntimeError):
    """The composer could not produce a usable plan."""


class Composer(Protocol):
    label: str

    def compose(self, request: GenerationRequest) -> GenerationProposal: ...


class ProceduralComposer:
    label = "procedural"

    def compose(self, request: GenerationRequest) -> GenerationProposal:
        return generate_arrangement(request)


SYSTEM_PROMPT = """You are the composer for SynaptixPlay, a trivia game. You write short, \
loopable electronic game-music arrangements as structured plans; software renders your plan \
into MIDI for four instruments: drums, bass, harmony (chords) and a lead melody.

How the plan becomes music:
- All pitches are natural-minor scale degrees of the requested key (0 = tonic, 1-6 up the \
scale, 7 = the octave, negative numbers go below). Chords are triads built on the degree you \
give, so choose degrees for good voice leading and cadences (e.g. 0, 5, 3, 6 or 0, 3, 4, 0).
- Each bar has 16 steps of a 16th note. Drum and bass patterns are 16-character strings.
- The melody is a phrase of one or more bars that repeats across its section, so write \
memorable, singable motifs with rests, a clear rhythm and a sense of question and answer.

Arrangement guidance:
- Write 3 to 6 sections whose bars add up to the requested length. Use the section kinds \
to shape the game moment: intro (establish), main (the loop players hear most), tension \
(clocks running low, higher energy and denser rhythm), victory (a bright resolving payoff).
- Match the mood, energy and complexity you are given, and follow the creative brief when \
there is one. Vary sections so the arrangement builds, but keep the main loop steady.
- Keep the kick and snare readable under gameplay; reserve accents for downbeats and fills."""


def _user_prompt(request: GenerationRequest) -> str:
    brief = request.brief.strip() if request.brief else "(none)"
    return (
        f"Compose an arrangement plan.\n"
        f"Key: {request.key}\n"
        f"Tempo: {request.tempo} BPM\n"
        f"Length: {request.durationBars} bars in 4/4\n"
        f"Mood: {request.mood}\n"
        f"Energy: {request.energy:.2f} (0 calm - 1 intense)\n"
        f"Complexity: {request.complexity:.2f} (0 simple - 1 intricate)\n"
        f"Creative brief: {brief}"
    )


def _describe_api_error(error: Exception) -> str:
    """A plain reason for an Anthropic API failure; never includes URLs or keys."""
    import anthropic

    if isinstance(error, TypeError) and "authentication" in str(error).lower():
        return "no Anthropic API key is configured"
    if isinstance(error, anthropic.AuthenticationError):
        return "the Anthropic API key was rejected"
    if isinstance(error, anthropic.PermissionDeniedError):
        return "the Anthropic API key cannot use this model"
    if isinstance(error, anthropic.NotFoundError):
        return "the configured Claude model was not found"
    if isinstance(error, anthropic.RateLimitError):
        return "the Anthropic API is rate limiting requests; try again shortly"
    if isinstance(error, anthropic.APIStatusError):
        return f"the Anthropic API returned an error ({error.status_code})"
    if isinstance(error, anthropic.APIConnectionError):
        return "the Anthropic API could not be reached"
    return type(error).__name__


class ClaudeComposer:
    label = "Claude"

    def __init__(self, client: Any | None = None, model: str = DEFAULT_CLAUDE_MODEL) -> None:
        if client is None:
            import anthropic  # Only needed when this composer is selected.

            client = anthropic.Anthropic()
        self._client = client
        self._model = model

    def compose(self, request: GenerationRequest) -> GenerationProposal:
        # Streaming keeps long plans clear of HTTP timeouts; `fallbacks="default"`
        # re-runs a request declined by a safety classifier on Anthropic's
        # recommended fallback model instead of failing the job.
        try:
            with self._client.beta.messages.stream(
                model=self._model,
                max_tokens=32000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                thinking={"type": "adaptive"},
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": _user_prompt(request)}],
                output_format=ArrangementPlan,
            ) as stream:
                message = stream.get_final_message()
        except Exception as error:  # noqa: BLE001 - translated for the person reading the warning
            raise ComposerError(_describe_api_error(error)) from error

        if message.stop_reason == "refusal":
            raise ComposerError("the model declined the request")
        if message.stop_reason == "max_tokens":
            raise ComposerError("the plan was cut off before it finished")
        plan = getattr(message, "parsed_output", None)
        if not isinstance(plan, ArrangementPlan):
            raise ComposerError("the response did not contain a valid arrangement plan")

        return render_plan(
            request,
            plan,
            generator_id="synaptix-claude-composer",
            generator_version=CLAUDE_COMPOSER_VERSION,
            model=getattr(message, "model", self._model),
        )


class LocalComposer:
    """An open-weight model served by Ollama on the local GPU.

    It writes the same ArrangementPlan as the Claude composer; Ollama constrains
    the output to the plan's JSON schema, and the plan is validated again here
    before rendering, so a small model can't produce out-of-key or broken notes.
    """

    label = "local model"

    def __init__(
        self,
        base_url: str = DEFAULT_LOCAL_MODEL_URL,
        model: str = DEFAULT_LOCAL_MODEL,
        timeout_seconds: float = 170.0,
        http: Any | None = None,
    ) -> None:
        import httpx

        self._model = model
        self._http = http or httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout_seconds)

    def compose(self, request: GenerationRequest) -> GenerationProposal:
        import httpx

        try:
            response = self._http.post(
                "/api/chat",
                json={
                    "model": self._model,
                    "stream": False,
                    "format": ArrangementPlan.model_json_schema(),
                    # Ollama's default 4K context can cut a full plan off mid-way.
                    "options": {"temperature": 0.7, "seed": request.seed, "num_ctx": 8192},
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": _user_prompt(request)},
                    ],
                },
            )
            response.raise_for_status()
        except httpx.TimeoutException as error:
            raise ComposerError("the local model took too long to answer") from error
        except httpx.HTTPStatusError as error:
            if error.response.status_code == 404:
                raise ComposerError(
                    f"the local model '{self._model}' is not downloaded yet"
                ) from error
            raise ComposerError(
                f"the local model server returned an error ({error.response.status_code})"
            ) from error
        except httpx.HTTPError as error:
            raise ComposerError("the local model server could not be reached") from error

        content = (response.json().get("message") or {}).get("content") or ""
        try:
            plan = ArrangementPlan.model_validate_json(content)
        except ValueError as error:
            raise ComposerError(
                "the local model did not return a valid arrangement plan"
            ) from error

        return render_plan(
            request,
            plan,
            generator_id="synaptix-local-composer",
            generator_version=LOCAL_COMPOSER_VERSION,
            model=self._model,
        )


def composer_from_env(env: Mapping[str, str] | None = None) -> Composer:
    env = os.environ if env is None else env
    choice = env.get("SYNAPTIX_COMPOSER", "procedural").strip().lower()
    if choice == "claude":
        return ClaudeComposer(model=env.get("SYNAPTIX_CLAUDE_MODEL", DEFAULT_CLAUDE_MODEL))
    if choice == "local":
        return LocalComposer(
            base_url=env.get("SYNAPTIX_LOCAL_MODEL_URL", DEFAULT_LOCAL_MODEL_URL),
            model=env.get("SYNAPTIX_LOCAL_MODEL", DEFAULT_LOCAL_MODEL),
        )
    return ProceduralComposer()


def compose_arrangement(request: GenerationRequest, composer: Composer) -> GenerationProposal:
    try:
        return composer.compose(request)
    except Exception as error:  # noqa: BLE001 - any AI failure must fall back, not fail the job
        if isinstance(composer, ProceduralComposer):
            raise
        logger.warning("%s composer failed; using procedural", composer.label, exc_info=True)
        reason = str(error) if isinstance(error, ComposerError) else type(error).__name__
        proposal = generate_arrangement(request)
        proposal.warnings.append(
            f"The {composer.label} composer was unavailable ({reason}), "
            "so the procedural composer wrote this arrangement."
        )
        return proposal
