# Docker Container Guide

Complete guide for building, running, and managing agent-runner as a containerized service.

## Overview

Agent-runner is deployed as a Docker container for:
- **Production deployments** - Kubernetes clusters
- **Local development** - Testing container behavior
- **CI/CD** - Automated builds and publishing

## Container Architecture

### Multi-Stage Build

The Dockerfile uses a three-stage build for optimization:

```
┌─────────────────────────────────────┐
│  Stage 1: base                      │
│  - Python 3.11-slim                 │
│  - System dependencies              │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  Stage 2: builder                   │
│  - Install Poetry                   │
│  - Install Python dependencies      │
│  - Create virtualenv (.venv)        │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  Stage 3: runtime                   │
│  - Python 3.11-slim (minimal)       │
│  - Copy app + dependencies          │
│  - Non-root user (stigmer)          │
│  - Health check configured          │
└─────────────────────────────────────┘
```

**Benefits**:
- Small final image (~150MB vs ~300MB with Poetry included)
- Fast builds with layer caching
- Secure non-root execution

### Security Features

**Non-Root User**:
- User: `stigmer`
- UID: 1000 (standard non-privileged user)
- All files owned by `stigmer:stigmer`

**Health Check**:
- Validates Python dependencies can load
- Runs every 30 seconds
- 40-second startup grace period
- 3 retries before marking unhealthy

**Minimal Attack Surface**:
- Only required runtime dependencies
- No build tools in final image
- No development packages

## Building Images

### Local Development Build

Build a single-architecture image for local testing:

```bash
cd backend/services/agent-runner
make build-image VERSION=dev-$(whoami)
```

This will:
1. Run type checking (`mypy`)
2. Build Docker image for `linux/amd64`
3. Tag as `ghcr.io/stigmer/agent-runner:dev-yourusername`
4. Also tag as `ghcr.io/stigmer/agent-runner:latest`

**Image size target**: <100MB (currently ~150MB with all dependencies)

### Multi-Architecture Build

Build for multiple platforms (amd64 + arm64):

```bash
make build-multiarch VERSION=1.2.3
```

Requires Docker Buildx. This creates a multi-arch manifest supporting:
- `linux/amd64` - Intel/AMD processors
- `linux/arm64` - ARM processors (Apple Silicon, AWS Graviton)

### Build Context

**Important**: Docker build context is the repository root, not the service directory.

```bash
# Correct (from service directory)
make build-image

# Correct (manual from repo root)
docker build -f backend/services/agent-runner/Dockerfile -t agent-runner .

# ❌ WRONG (build context too narrow)
docker build -f Dockerfile -t agent-runner .
```

This is required because the Dockerfile needs access to:
- `backend/libs/python/graphton/` (local Python library)
- `apis/stubs/python/` (protobuf stubs)

## Running Containers

### Local Testing

Start agent-runner container for local development:

```bash
# Set required environment variables first
export STIGMER_LLM_PROVIDER=openai
export STIGMER_LLM_MODEL=gpt-4
export OPENAI_API_KEY=sk-...

# Start container
make run-local
```

This command:
1. Stops any existing `stigmer-agent-runner` container
2. Creates volume mount: `~/.stigmer/data/workspace:/workspace`
3. Uses host networking (access to `localhost:7233` Temporal)
4. Passes required environment variables
5. Starts container in background

**View logs**:
```bash
make logs
```

**Stop container**:
```bash
make stop
```

### Manual Container Run

For more control, run Docker directly:

```bash
docker run -d \
  --name stigmer-agent-runner \
  --network host \
  -v ~/.stigmer/data/workspace:/workspace \
  -e MODE=local \
  -e SANDBOX_TYPE=filesystem \
  -e SANDBOX_ROOT_DIR=/workspace \
  -e TEMPORAL_SERVICE_ADDRESS=localhost:7233 \
  -e STIGMER_BACKEND_ENDPOINT=localhost:7234 \
  -e STIGMER_LLM_PROVIDER=openai \
  -e STIGMER_LLM_MODEL=gpt-4 \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  ghcr.io/stigmer/agent-runner:latest
```

## Volume Mounts

### Workspace Directory

**Mount**: `~/.stigmer/data/workspace:/workspace`

**Purpose**: Persist filesystem-based sandboxes across container restarts

**Why it's needed**:
- Session-based sandbox reuse (90% cost reduction)
- File persistence across conversation turns
- Skill files written to sandboxes
- Agent execution artifacts

**Permissions**:
- Container runs as UID 1000 (`stigmer` user)
- Volume directory should be writable by UID 1000
- On macOS: Docker Desktop handles this automatically
- On Linux: May need `chown 1000:1000 ~/.stigmer/data/workspace`

**Data stored**:
```
~/.stigmer/data/workspace/
├── session-{id}/           # Per-session sandbox
│   ├── skills/             # Skills written by agent-runner
│   ├── agent-files/        # Files created during execution
│   └── .graphton/          # Agent state
└── ...
```

## Network Configuration

### Host Networking (Recommended)

**Configuration**: `--network host`

**Rationale**:
- Container needs access to Temporal on `localhost:7233`
- Container needs access to stigmer-server on `localhost:7234`
- Simplest setup for local development
- No port mapping required

**Trade-off**: Container shares host network namespace

### Bridge Networking (Alternative)

If host networking is not available:

```bash
docker run -d \
  --name stigmer-agent-runner \
  -p 8080:8080 \
  -e TEMPORAL_SERVICE_ADDRESS=host.docker.internal:7233 \
  -e STIGMER_BACKEND_ENDPOINT=host.docker.internal:7234 \
  ...
```

**Caveats**:
- Requires `host.docker.internal` on macOS/Windows
- On Linux, use `--add-host=host.docker.internal:host-gateway`
- More complex setup

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TEMPORAL_SERVICE_ADDRESS` | Temporal server address | `localhost:7233` |
| `STIGMER_BACKEND_ENDPOINT` | stigmer-server gRPC endpoint | `localhost:7234` |
| `STIGMER_LLM_PROVIDER` | LLM provider (openai, anthropic, etc.) | `openai` |
| `STIGMER_LLM_MODEL` | LLM model name | `gpt-4` |

### LLM Provider Configuration

**OpenAI**:
```bash
-e STIGMER_LLM_PROVIDER=openai
-e STIGMER_LLM_MODEL=gpt-4
-e OPENAI_API_KEY=sk-...
```

**Anthropic**:
```bash
-e STIGMER_LLM_PROVIDER=anthropic
-e STIGMER_LLM_MODEL=claude-3-opus
-e ANTHROPIC_API_KEY=sk-...
```

**Custom Base URL**:
```bash
-e STIGMER_LLM_PROVIDER=openai
-e STIGMER_LLM_BASE_URL=https://api.custom.com/v1
-e STIGMER_LLM_API_KEY=...
```

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MODE` | Deployment mode | `local` |
| `SANDBOX_TYPE` | Sandbox backend | `filesystem` |
| `SANDBOX_ROOT_DIR` | Sandbox root path | `/workspace` |
| `LOG_LEVEL` | Logging level | `INFO` |
| `REDIS_HOST` | Redis host (cloud mode) | `localhost` |
| `REDIS_PORT` | Redis port (cloud mode) | `6379` |

### Runtime Environment Variables

Set automatically by container:

| Variable | Value | Purpose |
|----------|-------|---------|
| `PYTHONUNBUFFERED` | `1` | Real-time log output |
| `PYTHONDONTWRITEBYTECODE` | `1` | Skip .pyc file creation |

## Health Checks

### Container Health Check

**Configuration**:
- **Check**: Import Python dependencies and load config
- **Interval**: 30 seconds
- **Timeout**: 10 seconds
- **Retries**: 3 attempts before unhealthy
- **Start period**: 40 seconds grace period

**Command**:
```python
/app/.venv/bin/python -c "import sys; from worker.config import Config; sys.exit(0)"
```

**What it validates**:
- Python runtime works
- Virtual environment is correct
- Core dependencies can be imported
- Configuration can be loaded

**What it doesn't validate**:
- Temporal connection (checked on startup)
- LLM provider connectivity (checked per-execution)
- Backend gRPC connection (checked per-execution)

### Check Container Health

```bash
docker ps
# Look for "healthy" status in STATUS column

docker inspect stigmer-agent-runner | grep -A 5 Health
# View detailed health check results
```

### Startup Logs

The container logs show connection status on startup:

```
=============================================================
🚀 Stigmer Agent Runner - LOCAL Mode
=============================================================
Task Queue: default
Temporal: localhost:7233 (namespace: default)
Backend: localhost:7234
Sandbox: filesystem (root: /workspace)
=============================================================
✓ Signal handlers registered (SIGTERM, SIGINT)
🚀 Worker ready, polling for tasks...
```

## Troubleshooting

### Image Build Fails

**Problem**: Type checking fails before build

```
❌ Type checking failed
```

**Solution**: Fix type errors first
```bash
cd backend/services/agent-runner
poetry install
poetry run mypy grpc_client/ worker/ --show-error-codes
```

---

**Problem**: Cannot copy local dependencies

```
ERROR [builder 5/6] COPY backend/libs/python/graphton ...
```

**Solution**: Ensure build context is repository root
```bash
# From service directory
make build-image

# Or from repo root
docker build -f backend/services/agent-runner/Dockerfile -t agent-runner .
```

### Container Won't Start

**Problem**: Container exits immediately

```bash
docker logs stigmer-agent-runner
# Shows error: "Failed to load configuration"
```

**Solution**: Check required environment variables are set
```bash
docker inspect stigmer-agent-runner | grep -A 20 Env
# Verify all required vars are present
```

---

**Problem**: Health check fails

```bash
docker ps
# Shows "unhealthy" status
```

**Solution**: Check health check logs
```bash
docker inspect stigmer-agent-runner | grep -A 10 Health
```

### Connection Issues

**Problem**: Cannot connect to Temporal

```
❌ Failed to connect to Temporal at localhost:7233
```

**Solution**: Verify Temporal is running and network mode is correct
```bash
# Check Temporal is running
curl http://localhost:7233/health

# Verify host networking
docker inspect stigmer-agent-runner | grep NetworkMode
# Should show "host"
```

---

**Problem**: Cannot connect to stigmer-server

```
❌ Backend connection failed: localhost:7234
```

**Solution**: Verify stigmer-server is running
```bash
# Check stigmer-server is running
ps aux | grep stigmer-server

# Or check with CLI
stigmer server status
```

### Volume Mount Issues

**Problem**: Files not persisting across restarts

**Solution**: Verify volume mount is configured
```bash
docker inspect stigmer-agent-runner | grep -A 5 Mounts
# Should show /workspace mount
```

---

**Problem**: Permission denied writing to /workspace

```
PermissionError: [Errno 13] Permission denied: '/workspace/...'
```

**Solution** (Linux only):
```bash
# Fix ownership
chown -R 1000:1000 ~/.stigmer/data/workspace
```

On macOS, Docker Desktop handles this automatically.

### Image Size Too Large

**Problem**: Image is >200MB

**Solution**: Check layer sizes
```bash
docker history ghcr.io/stigmer/agent-runner:latest
```

**Common culprits**:
- Build dependencies in runtime image (should be multi-stage)
- Cached package manager files (should be cleaned)
- Included test/doc files (should be in .dockerignore)

## Publishing Images

### Authenticate to GitHub Container Registry

```bash
make docker-login
# Enter GitHub username and Personal Access Token
```

**Create token**: https://github.com/settings/tokens/new
- Scope: `write:packages`
- Expiration: 90 days (recommended)

### Push Single-Arch Image

For quick manual publishing:

```bash
make push-image VERSION=1.2.3
```

This builds and pushes `linux/amd64` only.

### Push Multi-Arch Image

For production releases:

```bash
make push-multiarch VERSION=1.2.3
```

This builds and pushes:
- `linux/amd64`
- `linux/arm64`

Creates a single manifest that works on both platforms.

## CI/CD Integration

See `.github/workflows/build-agent-runner-image.yml` for automated builds.

**Triggers**:
- Push to `main` → Build and push `:latest`
- Pull request → Build only (validation)
- Tag `v*` → Build and push all version tags

**Tags created** (for `v1.2.3`):
- `ghcr.io/stigmer/agent-runner:1.2.3`
- `ghcr.io/stigmer/agent-runner:1.2`
- `ghcr.io/stigmer/agent-runner:1`
- `ghcr.io/stigmer/agent-runner:latest`

## Best Practices

### Local Development

1. **Use version tags** for reproducibility:
   ```bash
   make build-image VERSION=feature-xyz
   make run-local VERSION=feature-xyz
   ```

2. **Check type errors before building**:
   ```bash
   make build  # Runs type checking
   ```

3. **Monitor logs during development**:
   ```bash
   make logs  # Follow container logs
   ```

4. **Clean up regularly**:
   ```bash
   make clean  # Remove images and containers
   ```

### Production

1. **Always use semantic versioning**:
   ```bash
   make push-multiarch VERSION=1.2.3
   ```

2. **Test images before publishing**:
   ```bash
   make build-image VERSION=1.2.3
   make test-image VERSION=1.2.3
   make run-local VERSION=1.2.3
   # Verify functionality
   make push-multiarch VERSION=1.2.3
   ```

3. **Use multi-arch builds** for production:
   - Supports both amd64 and arm64
   - Single manifest for all platforms
   - Better user experience

4. **Monitor image size**:
   ```bash
   docker images ghcr.io/stigmer/agent-runner
   ```
   Target: <100MB (currently ~150MB)

## References

- [Dockerfile](../Dockerfile) - Multi-stage build configuration
- [Makefile](../Makefile) - Build and run targets
- [.dockerignore](../.dockerignore) - Build context optimization
- [README.md](../README.md) - Service overview
- [Architecture: Agent Execution](architecture/agent-execution-workflow.md) - How agent-runner works
