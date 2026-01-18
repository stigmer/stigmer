# Stigmer Backend Services

Backend services for the open-source Stigmer agentic framework.

## Services

### agent-runner

Python Temporal worker that executes Graphton agents.

**Location**: `services/agent-runner/`  
**Language**: Python (Poetry)  
**Purpose**: Execute agent instances with real-time status updates

**Key Features**:
- Graphton agent execution
- Session-based sandbox management
- gRPC status updates to stigmer-server
- Skills integration

**See**: [services/agent-runner/README.md](services/agent-runner/README.md)

### workflow-runner

Go Temporal worker that executes CNCF Serverless Workflows.

**Location**: `services/workflow-runner/`  
**Language**: Go  
**Purpose**: Execute workflow instances using Temporal orchestration

**Key Features**:
- CNCF Serverless Workflow interpreter
- Claim Check pattern for large payloads
- Continue-As-New for unbounded workflows
- gRPC command controller

**See**: [services/workflow-runner/docs/README.md](services/workflow-runner/docs/README.md)

### stigmer-server

Go gRPC API server for local Stigmer deployment.

**Location**: `services/stigmer-server/`  
**Language**: Go  
**Purpose**: Main API server with SQLite storage

**Key Features**:
- gRPC API controllers (Agent, Workflow, Skill, etc.)
- SQLite storage with generic resource table (JSON documents)
- In-process gRPC calls (no network overhead)
- Protobuf validation

**Architecture**: See [ADR-007: Generic Resource Storage Strategy](../docs/adr/2026-01/2026-01-19-170000-sqllite-with-json-data.md)

## Libraries

### backend/libs/go/sqlite

Generic resource storage using SQLite with JSON documents.

**Pattern**: Single table with `kind` discriminator (simulates MongoDB collections)

**Key Components**:
- `Store` - SQLite connection and transaction management
- `SaveResource()` - Universal upsert for any proto message
- `ListResources()` - Query by resource kind
- `GetResource()` - Fetch by ID

### backend/libs/go/grpc

gRPC server utilities and middleware.

**Key Components**:
- Server lifecycle management
- Request/response logging
- Error handling and status codes
- Authentication middleware (future)

### backend/libs/go/validation

Protobuf validation utilities.

**Key Components**:
- Proto message validation
- Field-level constraint checking
- Error formatting

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Stigmer CLI                              │
│                  (cmd/stigmer/main.go)                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ In-process gRPC
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                  stigmer-server                              │
│              (Go gRPC API Server)                            │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Agent API    │  │ Workflow API │  │ Skill API    │      │
│  │ Controller   │  │ Controller   │  │ Controller   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                       │                                      │
│                       ↓                                      │
│         ┌──────────────────────────────┐                    │
│         │   SQLite Storage Layer       │                    │
│         │  (libs/go/sqlite)            │                    │
│         │                              │                    │
│         │  resources table:            │                    │
│         │  - id (PK)                   │                    │
│         │  - kind (discriminator)      │                    │
│         │  - data (JSON)               │                    │
│         └──────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
                       │
                       ↓
         ┌──────────────────────────────┐
         │   Temporal Orchestration     │
         └──────────────────────────────┘
                   ↙         ↘
          ┌──────────┐   ┌──────────────┐
          │  agent-  │   │  workflow-   │
          │  runner  │   │  runner      │
          └──────────┘   └──────────────┘
```

## Local Development

### Prerequisites

- Go 1.21+
- Python 3.11+
- Poetry
- Temporal Server (for agent/workflow execution)

### Running Services

**stigmer-server**:
```bash
cd backend/services/stigmer-server
go run cmd/server/main.go
```

**agent-runner**:
```bash
cd backend/services/agent-runner
poetry install
poetry run python main.py
```

**workflow-runner**:
```bash
cd backend/services/workflow-runner
go run cmd/grpc-server/main.go
```

## Storage Strategy

Stigmer uses a **generic single-table pattern** to avoid migration hell.

**Problem**: MongoDB automatically creates collections. SQLite requires schema migrations.

**Solution**: One `resources` table acts as a universal container with a `kind` discriminator.

```sql
CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,           -- "Agent", "Workflow", "Skill"
    org_id TEXT DEFAULT '',       -- Kept for cloud parity
    project_id TEXT DEFAULT '',
    data JSON NOT NULL,           -- Full proto serialized to JSON
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Benefits**:
- Zero schema migrations when adding new resource kinds
- 90% less persistence layer code
- Cloud parity (mimics MongoDB document model)

**Trade-offs**:
- Loss of type safety at DB level (validated at proto layer)
- Slower JSON queries (acceptable for local datasets <10k items)

**See**: [ADR-007: Generic Resource Storage Strategy](../docs/adr/2026-01/2026-01-19-170000-sqllite-with-json-data.md)

## Design Principles

### 1. Cloud Parity with Local Simplicity

The open-source backend mirrors the cloud architecture but optimized for single-user local development:

| Component | Cloud | Open Source |
|-----------|-------|-------------|
| API Server | stigmer-service (Java) | stigmer-server (Go) |
| Storage | MongoDB | SQLite + JSON |
| Auth | Auth0 + FGA | Local (no multi-tenancy) |
| Deployment | Kubernetes | Local binary |

### 2. In-Process gRPC

For local mode, gRPC calls happen in-process (no network overhead):

- CLI embeds stigmer-server as a library
- gRPC communication via in-memory transport
- Zero network latency, zero port conflicts

### 3. Extensibility

Adding a new resource kind requires:

1. Define proto in `apis/`
2. Generate code: `make protos`
3. Add controller in `stigmer-server`
4. **That's it** - no database migrations needed

---

**Last Updated**: January 19, 2026  
**Maintained By**: Stigmer Engineering Team
