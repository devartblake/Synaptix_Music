from fastapi import APIRouter

from app.generation.procedural import generate_arrangement
from app.models.generation import GenerationProposal, GenerationRequest

router = APIRouter()


@router.post("/projects", response_model=GenerationProposal)
def generate_project(request: GenerationRequest) -> GenerationProposal:
    return generate_arrangement(request)
