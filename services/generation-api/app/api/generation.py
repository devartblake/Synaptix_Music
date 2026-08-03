from fastapi import APIRouter
from pydantic import BaseModel, Field
router = APIRouter()
class GenerationRequest(BaseModel):
    project_id: str
    genre: str
    mood: str
    tempo: int = Field(ge=40, le=240)
    key: str
    duration_seconds: int = Field(ge=5, le=900)
@router.post("/projects")
def generate_project(request: GenerationRequest) -> dict[str, str]:
    return {"status": "accepted", "job_id": f"gen-{request.project_id}"}
