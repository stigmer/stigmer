# Agent Runner

Python Temporal worker service that executes Graphton agents for Stigmer agent execution.

## Quick Start

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

## What It Does

Agent Runner is a Python Temporal worker that:

- **Executes Graphton agents** - Creates agents at runtime and processes user messages
- **Manages sandboxes** - Session-based Daytona sandbox lifecycle for file persistence  
- **Streams updates** - Real-time execution updates to stigmer-service via gRPC
- **Handles skills** - Fetches and writes skills to sandboxes for agent access
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

### Kubernetes

```bash
# Local
kubectl apply -k _kustomize/overlays/local

# Production
kubectl apply -k _kustomize/overlays/prod
```

### Docker

```bash
# Build (from repo root)
docker build -f backend/services/agent-runner/Dockerfile -t agent-runner .

# Run
docker run -e TEMPORAL_SERVICE_ADDRESS=temporal:7233 \
           -e STIGMER_BACKEND_ENDPOINT=stigmer-service:8080 \
           agent-runner
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

Skills are written to sandboxes using progressive disclosure:

- System prompt contains skill metadata (name, description, path)
- Agent reads full content on-demand via `read_file` tool
- Token optimization through lazy loading

## Documentation

**Complete documentation**: [docs/README.md](docs/README.md)

**Key documents**:
- [Architecture: Agent Execution Workflow](docs/architecture/agent-execution-workflow.md)
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
