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
# curl: Required for health checks
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

WORKDIR /app/backend/services/agent-runner

# Create virtualenv
RUN python3 -m venv .venv

# Copy pinned requirements (auto-generated from poetry.lock, excludes path deps)
COPY backend/services/agent-runner/requirements.txt ./
RUN .venv/bin/pip install --no-cache-dir -r requirements.txt

# Install local path dependencies
COPY backend/libs/python/graphton /app/backend/libs/python/graphton
COPY apis/stubs/python /app/apis/stubs/python
RUN .venv/bin/pip install --no-cache-dir /app/backend/libs/python/graphton
RUN .venv/bin/pip install --no-cache-dir /app/apis/stubs/python/stigmer

# WORKAROUND: deepagents-cli (0.0.3) ships files in the `deepagents/` namespace that
# overwrite clean files from the `deepagents` package during installation. This is an
# upstream packaging defect -- both packages write to the same directory, and the CLI
# package's copies are corrupted/truncated. Reinstalling `deepagents` after pip
# restores the correct files. The verification step below will catch any regression.
RUN .venv/bin/pip install --force-reinstall --no-deps deepagents==0.4.0

# Verify deepagents is importable (catches corrupted PyPI packages at build time).
RUN .venv/bin/python -c "\
from deepagents.middleware.subagents import SubAgentMiddleware; \
from deepagents.middleware.filesystem import FilesystemMiddleware; \
from deepagents import create_deep_agent; \
print('deepagents import verification passed')"

# Verify all LangGraph checkpointer backends are importable.
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
COPY backend/services/agent-runner/main.py ./
COPY backend/services/agent-runner/src/ ./src/

# Copy local path dependencies (needed on PYTHONPATH for imports)
COPY backend/libs/python/graphton /app/backend/libs/python/graphton
COPY apis/stubs/python /app/apis/stubs/python

# Copy virtualenv from builder stage
COPY --from=builder /app/backend/services/agent-runner/.venv /app/.venv

# Fix ownership for non-root user
RUN chown -R stigmer:stigmer /app

# Switch to non-root user
USER stigmer

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD /app/.venv/bin/python -c "from stigmer_runner.worker.config import Config; from deepagents.middleware.subagents import SubAgentMiddleware" || exit 1

# Expose volume mount point for documentation
# Actual mount is configured by CLI: -v ~/.stigmer/data/workspace:/workspace
VOLUME ["/workspace"]

# Environment variable defaults (can be overridden)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH="/app/src" \
    LOG_LEVEL=INFO

# Run with virtualenv Python
CMD ["/app/.venv/bin/python", "main.py"]
