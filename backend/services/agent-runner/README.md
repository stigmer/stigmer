# Agent Runner

Python Temporal worker service that executes Graphton agents for Stigmer agent execution.

## Quick Start

### Docker (Recommended)

```bash
# Build and run in container (requires Docker or Podman)
make build-image VERSION=dev-local
make run-local

# View logs
make logs
```

See **[Docker Guide](docs/docker.md)** for complete container documentation.

### Local Python Development

```bash
# Install dependencies
poetry install

# Set required environment variables
export TEMPORAL_SERVICE_ADDRESS=localhost:7233
export STIGMER_BACKEND_ENDPOINT=localhost:8080
export AUTH0_DOMAIN=stigmer.auth0.com
export AUTH0_AUDIENCE=https://api.stigmer.ai
export MACHINE_ACCOUNT_CLIENT_ID=your-client-id
export MACHINE_ACCOUNT_CLIENT_SECRET=your-client-secret
export DAYTONA_API_KEY=your-daytona-api-key

# Run worker
python main.py
```

## Execution Modes

The agent-runner supports multiple execution modes via the `run.sh` launcher script:

### 1. Production Mode (Extracted Binaries)
Runs from extracted binaries in `~/.stigmer/data/bin/agent-runner/`

```bash
# Daemon automatically sets STIGMER_AGENT_RUNNER_WORKSPACE
STIGMER_AGENT_RUNNER_WORKSPACE=/path/to/extracted/agent-runner ./run.sh
```

### 2. Bazel Mode
Runs via Bazel build system:

```bash
bazel run //backend/services/agent-runner
# BUILD_WORKSPACE_DIRECTORY is set automatically by Bazel
```

### 3. Development Mode
Runs from source tree (detects workspace by finding `MODULE.bazel`):

```bash
cd backend/services/agent-runner
./run.sh  # Automatically finds workspace root
```

The `run.sh` script determines the workspace root (where `pyproject.toml` lives) in this precedence order:
1. `STIGMER_AGENT_RUNNER_WORKSPACE` (production/explicit)
2. `BUILD_WORKSPACE_DIRECTORY` (Bazel)
3. Directory tree walking (development)

## What It Does

Agent Runner is a Python Temporal worker that:

- **Executes Graphton agents** - Creates agents at runtime and processes user messages
- **Manages sandboxes** - Session-based Daytona sandbox lifecycle for file persistence  
- **Streams updates** - Real-time execution updates to stigmer-service via gRPC
- **Handles skills** - Downloads artifacts, extracts to `/bin/skills/{hash}/`, injects SKILL.md into prompts
- **Merges environments** - Layers multiple environment configurations

## Architecture

### Execution Flow

```
Temporal Workflow (Java) → Python Activities → Graphton Agent
                      ↓
                 gRPC Status Updates → stigmer-service → MongoDB/Redis
```

**Key Features**:
- Real-time status updates every N events
- Progressive visibility (messages, tool calls, phase)
- Session-based sandbox reuse

### Resource Resolution

```
AgentExecution → Session → AgentInstance → Agent → Skills
```

See **[Architecture Documentation](docs/architecture/agent-execution-workflow.md)** for complete details.

## Development

### Type Checking

```bash
# Run type checking
make build
```

Type checking runs automatically in CI before Docker builds.

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TEMPORAL_SERVICE_ADDRESS` | Temporal server address | Yes |
| `STIGMER_BACKEND_ENDPOINT` | Stigmer backend gRPC endpoint | Yes |
| `AUTH0_DOMAIN` | Auth0 tenant domain | Yes |
| `AUTH0_AUDIENCE` | Auth0 API audience | Yes |
| `MACHINE_ACCOUNT_CLIENT_ID` | Machine account client ID | Yes |
| `MACHINE_ACCOUNT_CLIENT_SECRET` | Machine account client secret | Yes |
| `DAYTONA_API_KEY` | Daytona API key | Yes |
| `REDIS_HOST` | Redis host | No (default: localhost) |
| `REDIS_PORT` | Redis port | No (default: 6379) |
| `LOG_LEVEL` | Logging level | No (default: INFO) |

## Deployment

### Docker Container

**Local development**:
```bash
# Build image
make build-image VERSION=dev-$(whoami)

# Run locally (requires Temporal + stigmer-server running)
export STIGMER_LLM_PROVIDER=openai
export STIGMER_LLM_MODEL=gpt-4
export OPENAI_API_KEY=your-key
make run-local

# View logs
make logs

# Stop
make stop
```

**Publishing**:
```bash
# Authenticate once
make docker-login

# Build and push multi-arch images (production)
make push-multiarch VERSION=1.2.3
```

See **[docs/docker.md](docs/docker.md)** for complete guide including:
- Multi-stage build architecture
- Security features (non-root user, health checks)
- Volume mounts and persistence
- Network configuration
- Environment variables reference
- Troubleshooting guide

### Kubernetes

```bash
# Local
kubectl apply -k _kustomize/overlays/local

# Production
kubectl apply -k _kustomize/overlays/prod
```

## Key Features

### Session-Based Sandbox Reuse

Sandboxes are created once per session and reused across executions:

- **90% cost reduction** for multi-turn conversations
- **2-27s saved per message** after first message
- File persistence across conversation turns

### Environment Merging

Multiple environments are layered with proper overrides:

```
agent.env_spec → environment[0] → environment[1] → runtime_env
```

### Skills Integration

Skills provide reusable capabilities (instructions + executable tools) to agents:

- **Artifact download & extraction**: Downloads ZIP files from R2 storage, extracts to `/bin/skills/{hash}/`
- **SKILL.md injection**: Full interface definition injected into system prompt with LOCATION headers
- **Executable access**: Scripts and tools available at versioned paths
- **Graceful degradation**: Falls back to SKILL.md-only if artifacts unavailable
- **Content-addressable storage**: SHA256 hashing enables deduplication and immutable versioning

See [Architecture: Skill Architecture](docs/architecture/skill-architecture.md) for complete details.

## Documentation

**Complete documentation**: [docs/README.md](docs/README.md)

**Key documents**:
- [Architecture: Agent Execution Workflow](docs/architecture/agent-execution-workflow.md)
- [Architecture: Skill Architecture](docs/architecture/skill-architecture.md)
- [Guide: Working with Agent Execution](docs/guides/working-with-agent-execution.md)
- [Architecture: Data Model](docs/architecture/data-model.md)
- [Implementation: Type Checking](docs/implementation/type-checking.md)

## Related Services

- **stigmer-service** - Java orchestration service with gRPC APIs
- **workflow-runner** - Go Temporal workflow execution service

## Dependencies

- **Graphton** - Python framework for LLM agents
- **Temporal** - Workflow orchestration platform  
- **Daytona** - Development sandbox platform
