from functools import lru_cache

from fastapi import APIRouter

from app.generation.composers import Composer, compose_arrangement, composer_from_env
from app.models.generation import GenerationProposal, GenerationRequest

router = APIRouter()


@lru_cache(maxsize=1)
def active_composer() -> Composer:
    """The composer chosen by SYNAPTIX_COMPOSER, created once per process."""
    return composer_from_env()


@router.post("/projects", response_model=GenerationProposal)
def generate_project(request: GenerationRequest) -> GenerationProposal:
    return compose_arrangement(request, active_composer())
