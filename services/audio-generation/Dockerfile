# Prototype text-to-audio (MusicGen) on the local NVIDIA GPU.
# MusicGen weights are CC-BY-NC 4.0: outputs are prototype-only and never published.
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    HF_HUB_DISABLE_TELEMETRY=1
WORKDIR /app
COPY services/audio-generation/pyproject.toml ./
COPY services/audio-generation/app ./app
RUN pip install --no-cache-dir ".[model]" \
    && useradd --create-home app \
    && mkdir -p /models && chown app /models

USER app
EXPOSE 8400
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8400"]
