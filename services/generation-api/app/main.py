from fastapi import FastAPI

from app.api.generation import router as generation_router

app = FastAPI(title="Synaptix Music Generation API", version="0.1.0")
app.include_router(generation_router, prefix="/generation", tags=["generation"])


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
def readyz() -> dict[str, str]:
    return {"status": "ready"}
