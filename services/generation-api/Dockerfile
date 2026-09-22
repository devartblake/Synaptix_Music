FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY services/generation-api/pyproject.toml ./
COPY services/generation-api/app ./app
RUN pip install --no-cache-dir . && useradd --create-home app

USER app
EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
