# Stigmer Server

Go gRPC API server for local Stigmer deployment.

## Overview

Stigmer Server is the main API server for the open-source Stigmer agentic framework. It provides gRPC APIs for managing agents, workflows, skills, and other resources using SQLite storage.

## Architecture

```
┌─────────────────────────────────────────┐
│           Stigmer CLI                   │
└────────────────┬────────────────────────┘
                 │ In-process gRPC
                 ↓
┌─────────────────────────────────────────┐
│         Stigmer Server                  │
│                                         │
│  Controllers:                           │
│  - AgentController                      │
│  - WorkflowController                   │
│  - SkillController                      │
│  - EnvironmentController                │
│  - SessionController                    │
│                                         │
│         ↓                               │
│  ┌──────────────────┐                  │
│  │  SQLite Storage  │                  │
│  │  (Generic Table) │                  │
│  └──────────────────┘                  │
└─────────────────────────────────────────┘
```

## Features

- **gRPC API Controllers** - Command and Query controllers for all resource types
- **SQLite Storage** - Generic resource table with JSON documents
- **In-Process gRPC** - Zero network overhead for local CLI usage
- **Protobuf Validation** - Request validation using proto constraints
- **Zero Schema Migrations** - Add new resource types without database changes

## Quick Start

### Build

```bash
cd backend/services/stigmer-server
go build -o stigmer-server cmd/server/main.go
```

### Run

```bash
./stigmer-server
```

Default configuration:
- **Port**: 8080
- **Database**: `~/.stigmer/stigmer.db`
- **Log Level**: INFO

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GRPC_PORT` | gRPC server port | 8080 |
| `DB_PATH` | SQLite database path | `~/.stigmer/stigmer.db` |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | info |
| `ENV` | Environment (local, dev, prod) | local |

## Controllers

### Agent Controller

Implements `AgentCommandController` and `AgentQueryController`.

**Commands**:
- `Create` - Create a new agent
- `Update` - Update an existing agent
- `Delete` - Delete an agent

**Queries**:
- `Get` - Get agent by ID
- `List` - List all agents
- `FindByName` - Find agent by name

### Workflow Controller

Implements `WorkflowCommandController` and `WorkflowQueryController`.

**Commands**:
- `Create` - Create a new workflow
- `Update` - Update an existing workflow
- `Delete` - Delete a workflow

**Queries**:
- `Get` - Get workflow by ID
- `List` - List all workflows
- `FindByName` - Find workflow by name

## Storage

Stigmer Server uses the **Generic Single-Table Pattern** to avoid migration hell.

**See**: [ADR-007: Generic Resource Storage Strategy](../../../docs/adr/2026-01/2026-01-19-170000-sqllite-with-json-data.md)

### How It Works

All resources are stored in a single `resources` table:

```sql
CREATE TABLE resources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,           -- "Agent", "Workflow", "Skill"
    org_id TEXT DEFAULT '',
    project_id TEXT DEFAULT '',
    data JSON NOT NULL,           -- Full proto serialized to JSON
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Benefits**:
- Zero schema migrations when adding new resource kinds
- 90% less persistence layer code
- Cloud parity (mimics MongoDB document model)

## Development

### Project Structure

```
stigmer-server/
├── cmd/
│   └── server/
│       └── main.go              # Server entry point
├── pkg/
│   ├── config/
│   │   └── config.go            # Configuration
│   └── controllers/
│       ├── agent_controller.go  # Agent command/query controller
│       ├── workflow_controller.go
│       └── skill_controller.go
├── docs/
│   └── README.md
└── README.md
```

### Adding a New Controller

1. **Create controller file**:

```go
package controllers

import (
    "context"
    "github.com/stigmer/stigmer/backend/libs/go/grpc"
    "github.com/stigmer/stigmer/backend/libs/go/sqlite"
    resourcev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/resource/v1"
)

type ResourceController struct {
    resourcev1.UnimplementedResourceCommandControllerServer
    resourcev1.UnimplementedResourceQueryControllerServer
    store *sqlite.Store
}

func NewResourceController(store *sqlite.Store) *ResourceController {
    return &ResourceController{store: store}
}

// Implement command methods (Create, Update, Delete)
// Implement query methods (Get, List, Find...)
```

2. **Register in main.go**:

```go
resourceController := controllers.NewResourceController(store)
resourcev1.RegisterResourceCommandControllerServer(grpcServer, resourceController)
resourcev1.RegisterResourceQueryControllerServer(grpcServer, resourceController)
```

3. **Done!** - No database migrations needed.

### Testing

```bash
# Run tests
go test ./...

# Run with coverage
go test -cover ./...
```

### Testing with grpcurl

```bash
# Install grpcurl
brew install grpcurl

# List services
grpcurl -plaintext localhost:8080 list

# Create an agent
grpcurl -plaintext -d @ localhost:8080 ai.stigmer.agentic.agent.v1.AgentCommandController/Create <<EOF
{
  "agent": {
    "api_resource_metadata": {
      "name": "test-agent"
    },
    "spec": {
      "description": "A test agent",
      "model": "gpt-4"
    }
  }
}
EOF

# Get an agent
grpcurl -plaintext -d '{"id": "agent-123"}' localhost:8080 ai.stigmer.agentic.agent.v1.AgentQueryController/Get

# List agents
grpcurl -plaintext localhost:8080 ai.stigmer.agentic.agent.v1.AgentQueryController/List
```

## Deployment

### Docker

```dockerfile
FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY . .
RUN go build -o stigmer-server cmd/server/main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates
COPY --from=builder /app/stigmer-server /stigmer-server
ENTRYPOINT ["/stigmer-server"]
```

### Kubernetes

Not applicable for open-source local deployment. Stigmer Server runs as a local binary.

## Differences from Stigmer Cloud

| Feature | Stigmer Cloud (stigmer-service) | Stigmer Server (open source) |
|---------|--------------------------------|------------------------------|
| Language | Java (Spring Boot) | Go |
| Storage | MongoDB | SQLite + JSON |
| Auth | Auth0 + FGA | None (local only) |
| Multi-tenancy | Yes (org_id isolation) | No |
| Deployment | Kubernetes | Local binary |
| Scale | Hundreds of orgs | Single user |

## Related Services

- **agent-runner** - Python Temporal worker for agent execution
- **workflow-runner** - Go Temporal worker for workflow execution

## Related Documentation

- [Backend Architecture](../../README.md)
- [SQLite Storage](../../libs/go/sqlite/README.md)
- [gRPC Utilities](../../libs/go/grpc/README.md)
- [ADR-007: Generic Resource Storage](../../../docs/adr/2026-01/2026-01-19-170000-sqllite-with-json-data.md)

---

**Last Updated**: January 19, 2026  
**Maintained By**: Stigmer Engineering Team
