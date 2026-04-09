# Multi-stage Dockerfile for agent-runner service
# Optimized for size, security, and production deployment
#
# Build context: Repository root
# Build command: docker build -f backend/services/agent-runner/Dockerfile -t agent-runner .

# ---------- Base Layer with Python ----------
FROM public.ecr.aws/docker/library/python:3.11-slim AS base

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

# 2. stigmer-protos (../../../apis/stubs/python/stigmer)
COPY apis/stubs/python /app/apis/stubs/python

# Install dependencies into in-project virtualenv
ENV POETRY_VIRTUALENVS_IN_PROJECT=true
RUN poetry config virtualenvs.in-project true && \
    poetry install --only main --no-interaction --no-ansi --no-root

# WORKAROUND: deepagents-cli (0.0.3) ships files in the `deepagents/` namespace that
# overwrite clean files from the `deepagents` package during installation. This is an
# upstream packaging defect -- both packages write to the same directory, and the CLI
# package's copies are corrupted/truncated. Reinstalling `deepagents` after Poetry
# restores the correct files. The verification step below will catch any regression.
RUN .venv/bin/pip install --force-reinstall --no-deps deepagents==0.4.0

# Verify deepagents is importable (catches corrupted PyPI packages at build time).
# This gate is specifically for the deepagents-cli namespace collision (see WORKAROUND above)
# which is a runtime packaging defect that linters cannot detect.
# Python syntax errors in first-party code (graphton, worker) are caught earlier by
# pre-commit hooks (ruff) and make lint -- they do not need Docker build-time verification.
RUN .venv/bin/python -c "\
from deepagents.middleware.subagents import SubAgentMiddleware; \
from deepagents.middleware.filesystem import FilesystemMiddleware; \
from deepagents import create_deep_agent; \
print('deepagents import verification passed')"

# Verify all LangGraph checkpointer backends are importable.
# langgraph-checkpoint-mongodb and langgraph-checkpoint-sqlite are separate
# pip packages that share the langgraph.checkpoint namespace. If a version
# upgrade breaks namespace package resolution, this gate catches it at build
# time instead of causing a runtime crash loop in production.
RUN .venv/bin/python -c "\
from langgraph.checkpoint.memory import MemorySaver; \
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver; \
from langgraph.checkpoint.mongodb import MongoDBSaver; \
print('checkpointer import verification passed')"

# ---------- Runtime Image ----------
FROM public.ecr.aws/docker/library/python:3.11-slim

WORKDIR /app

# ---------- Minimal System Dependencies ----------
# The agent-runner is a pure Python orchestrator. Stdio MCP servers run
# inside the Daytona sandbox (cloud mode) or as host subprocesses (local
# mode). No MCP runtimes (Node.js, Go, uvx) are needed in this image.
#   git: Required for workspace operations and pip git-based installs
#   ca-certificates: Required for HTTPS connections (gRPC, Daytona API)
#   curl: Required for health checks
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for security
# UID 1000 is standard for first non-privileged user on Linux
RUN groupadd -g 1000 stigmer && \
    useradd -r -u 1000 -g stigmer -m stigmer

# Create workspace directory
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

# Health check: Verify Python process can start and import critical dependencies.
# Tests both local code (worker.config) and external packages (deepagents) to catch
# corrupted package installations that would cause the worker to crash-loop at startup.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD /app/.venv/bin/python -c "from worker.config import Config; from deepagents.middleware.subagents import SubAgentMiddleware" || exit 1

# Expose volume mount point for documentation
# Actual mount is configured by CLI: -v ~/.stigmer/data/workspace:/workspace
VOLUME ["/workspace"]

# Environment variable defaults (can be overridden)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LOG_LEVEL=INFO

# Run with virtualenv Python
CMD ["/app/.venv/bin/python", "main.py"]
