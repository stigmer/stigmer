# ---------- base layer with Python ----------
FROM --platform=linux/amd64 python:3.13-slim AS base

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git curl ca-certificates build-essential && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---------- builder: installs poetry deps ----------
FROM base AS builder

# Match repo structure for path deps to resolve
WORKDIR /app/backend/services/agent-runner

RUN curl -fsSL https://install.python-poetry.org | python3 - && \
    mv /root/.local/bin/poetry /usr/local/bin/poetry

# Copy lock files first to leverage cache (expects repo root as build context)
COPY backend/services/agent-runner/pyproject.toml backend/services/agent-runner/poetry.lock* ./

# Provide local path dependencies referenced in pyproject.toml
COPY apis/stubs/python /app/apis/stubs/python

# Create venv in predictable location
ENV POETRY_VIRTUALENVS_IN_PROJECT=true
RUN poetry config virtualenvs.in-project true && \
    poetry install --no-interaction --no-ansi

# ---------- runtime image ----------
FROM python:3.13-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Bring in application source
COPY backend/services/agent-runner/ ./

# Bring in proto stubs
COPY apis/stubs/python /app/apis/stubs/python

# Copy venv from builder
COPY --from=builder /app/backend/services/agent-runner/.venv /app/.venv

# Use venv Python
CMD ["/app/.venv/bin/python", "main.py"]
