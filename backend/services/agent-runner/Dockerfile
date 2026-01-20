# Multi-stage Dockerfile for agent-runner service
# Optimized for size, security, and production deployment
#
# Build context: Repository root
# Build command: docker build -f backend/services/agent-runner/Dockerfile -t agent-runner .

# ---------- Base Layer with Python ----------
FROM python:3.11-slim AS base

WORKDIR /app

# Install minimal system dependencies
# git: Required for Poetry to install git-based dependencies
# curl: Required for health checks and Poetry installation
# ca-certificates: Required for HTTPS connections
# build-essential: Required for building Python packages with C extensions
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
        build-essential && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# ---------- Builder Stage: Install Dependencies ----------
FROM base AS builder

# Match repository structure for local path dependencies to resolve correctly
WORKDIR /app/backend/services/agent-runner

# Install Poetry
RUN curl -fsSL https://install.python-poetry.org | python3 - && \
    mv /root/.local/bin/poetry /usr/local/bin/poetry

# Copy dependency files first for optimal layer caching
# Build context is repo root, so paths are relative to root
COPY backend/services/agent-runner/pyproject.toml backend/services/agent-runner/poetry.lock* ./

# Copy local path dependencies referenced in pyproject.toml
# 1. graphton (../../libs/python/graphton)
COPY backend/libs/python/graphton /app/backend/libs/python/graphton

# 2. stigmer-stubs (../../../apis/stubs/python/stigmer)
COPY apis/stubs/python /app/apis/stubs/python

# Install dependencies into in-project virtualenv
ENV POETRY_VIRTUALENVS_IN_PROJECT=true
RUN poetry config virtualenvs.in-project true && \
    poetry install --only main --no-interaction --no-ansi --no-root

# ---------- Runtime Image ----------
FROM python:3.11-slim

WORKDIR /app

# Install minimal runtime dependencies
# git: May be needed by some Python packages at runtime
# ca-certificates: Required for HTTPS connections
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git \
        ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for security
# UID 1000 is standard for first non-privileged user on Linux
RUN groupadd -g 1000 stigmer && \
    useradd -r -u 1000 -g stigmer stigmer

# Create workspace directory for volume mounts
# This directory will be mounted from host for sandbox persistence
RUN mkdir -p /workspace && \
    chown -R stigmer:stigmer /workspace

# Copy application source
COPY backend/services/agent-runner/ ./

# Copy local path dependencies
COPY backend/libs/python/graphton /app/backend/libs/python/graphton
COPY apis/stubs/python /app/apis/stubs/python

# Copy virtualenv from builder stage
COPY --from=builder /app/backend/services/agent-runner/.venv /app/.venv

# Fix ownership for non-root user
RUN chown -R stigmer:stigmer /app

# Switch to non-root user
USER stigmer

# Health check: Verify Python process can start and import dependencies
# This is a lightweight check - full Temporal connection check happens in startup logs
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD /app/.venv/bin/python -c "import sys; from worker.config import Config; sys.exit(0)" || exit 1

# Expose volume mount point for documentation
# Actual mount is configured by CLI: -v ~/.stigmer/data/workspace:/workspace
VOLUME ["/workspace"]

# Environment variable defaults (can be overridden)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LOG_LEVEL=INFO

# Run with virtualenv Python
CMD ["/app/.venv/bin/python", "main.py"]
