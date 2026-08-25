# Stigmer Backend Services

Backend services for the open-source Stigmer agentic platform.

`backend/services/` holds exactly two services. Earlier editions had separate
Python (`agent-runner`) and Go (`workflow-runner`) execution services — both
are retired; one TypeScript runner now executes everything.

## Services

### stigmer-server

TypeScript gRPC control plane for local Stigmer deployment.

**Location**: `services/stigmer-server/`
**Language**: TypeScript (Node version pinned in `.nvmrc`; needs `node:sqlite` with FTS5, Node >= 22.13)
**Entry point**: `src/main.ts` (compiled; the daemon launches `dist/main.js`)

**Key responsibilities**:

- gRPC/gRPC-Web/Connect command/query controllers for every API resource
  (Agent, Workflow, Skill, Session, Environment, McpServer, …) on one port
- SQLite storage via `node:sqlite` (see [Storage](#storage) below)
- Temporal workflow orchestration for agent executions, workflow
  executions, and MCP server discovery
- Serves platform documents such as the model registry
  (`GET /v1/proxy/model-registry`, mirrored from the cloud edition)

**See**: [services/stigmer-server/README.md](services/stigmer-server/README.md)

### runner

TypeScript Temporal worker (`@stigmer/runner`, "stigmer-runner") that
executes **both agent sessions and workflow executions**, across both
harnesses:

- **deep-agent** — LangGraph.js-based agentic loop calling LLM provider
  APIs directly
- **cursor** — delegates execution to Cursor via `@cursor/sdk`

**Location**: `services/runner/`
**Language**: TypeScript (Node version pinned in `.nvmrc`)
**Entry point**: `src/main.ts` (`npm start` runs it via `tsx`)

**Key responsibilities**:

- Agent session execution: prompt assembly, tool orchestration, HITL
  approvals, attachments/vision, streaming status updates back to the
  control plane over gRPC
- Workflow execution: task interpretation and orchestration for every
  workflow task kind
- MCP server connection and capability discovery
  (`workflows/connect-mcp-server.ts`)
- Skill loading and sandbox/workspace management

The same runner image runs in the cloud edition — execution behavior is
identical in both editions by construction.

## Libraries (`backend/libs/ts/`)

| Library | Purpose |
|---------|---------|
| `temporal-codecs` | Temporal payload codecs (AES-256-GCM encryption + claim-check), shared by the server and the runner |
| `zip-structure` | Policy-free structural ZIP parsing (skill artifacts), shared by the server and the runner |

(The Go library tree, `backend/libs/go/`, retired with the Go server — go-server-retirement, D4 #25.)

## Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ stigmer CLI  │  │ Web console  │  │ SDKs / MCP   │
│ (@stigmer/   │  │ (Next.js)    │  │ clients      │
│  cli, TS)    │  │              │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ gRPC (local port)│                │
       ↓                  ↓                ↓
┌─────────────────────────────────────────────────┐
│              stigmer-server (TypeScript)        │
│  command/query controllers per API resource     │
│                       │                         │
│              ┌────────┴────────┐                │
│              │ SQLite storage  │                │
│              │  (node:sqlite)  │                │
│              └─────────────────┘                │
└──────────────────────┬──────────────────────────┘
                       │ Temporal
                       ↓
        ┌──────────────────────────────┐
        │      runner (TypeScript)     │
        │  agent sessions + workflow   │
        │  executions, both harnesses  │
        │  (deep-agent · cursor)       │
        └──────────────────────────────┘
```

In local mode the CLI acts as a supervisor: it acquires the server
(`@stigmer/server-slim`) and runner packages into `~/.stigmer/runtimes/`
and the Temporal dev server into `~/.stigmer/bin`, launches them as
daemons, and talks to the server over gRPC on a local port
(`client-apps/cli/src/local/`).

## Local Development

### Prerequisites

- Node.js (version pinned in `.nvmrc` — `nvm use`)
- Temporal dev server (the CLI downloads one automatically; for manual
  runs use the [Temporal CLI](https://docs.temporal.io/cli))

### Building and running

```bash
# Build the control plane → backend/services/stigmer-server/dist/
make build-server

# One-shot prep for the runner (proto stub dist + deps)
make bootstrap-runner

# Run the runner (Temporal worker)
cd backend/services/runner && npm start

# Run the control plane directly (must be compiled — the Temporal workers
# bundle workflow code from the built dist)
cd backend/services/stigmer-server && npm run build && node dist/main.js
```

For the end-user path, the published `stigmer` CLI (npm:
`@stigmer/cli`) supervises all of this automatically.

## Storage

The core is a **generic resource table** — one row per API resource,
serialized proto bytes in a single column, `kind` as the discriminator:

```sql
CREATE TABLE resources (
    kind TEXT NOT NULL,          -- "Agent", "Workflow", "Skill", …
    id   TEXT NOT NULL,
    data BLOB NOT NULL,          -- serialized proto
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (kind, id)
) WITHOUT ROWID;
```

Adding a new resource kind requires **no schema migration** — define the
proto, run `make codegen`, add the controller. Purpose-built side tables
exist where a generic row is the wrong shape (resource audit history,
workflow execution events, bootstrap state) — see
`backend/services/stigmer-server/src/store/sqlite/` (the migration chain in
`migrations.ts`) for the authoritative schema.

**Trade-offs**: no type safety at the DB level (validation lives at the
proto layer); queries by anything other than `(kind, id)` scan — fine for
local datasets.

**See**: [ADR-007: Generic Resource Storage Strategy](../docs/adr/2026-01/2026-01-19-170000-sqllite-with-json-data.md)

## Design Principles

### 1. Cloud parity with local simplicity

The open-source backend mirrors the cloud architecture, optimized for
single-user local development:

| Component | Cloud (`stigmer-cloud`) | Open source (this repo) |
|-----------|------------------------|-------------------------|
| Control plane | `stigmer-service` (Java, Spring Boot) | `stigmer-server` (TypeScript) |
| Runner | same TypeScript runner image | `services/runner` |
| Storage | MongoDB (+ Redis, Postgres, object storage) | SQLite |
| Auth | Auth0 + OpenFGA | lightweight local identity |
| Deployment | Kubernetes | local binaries under `~/.stigmer` |

The proto contracts in `apis/` are the single source of truth for both
editions; core resource behavior must be identical across them.

### 2. Proto-first

Every backend change starts at the proto contract. After any `.proto`
change, run `make codegen` — generated stubs (five languages), JSON
schemas, and API docs all flow from it. Never edit generated files.

### 3. One runner, two harnesses

Agent and workflow execution deliberately share one worker, one deploy
artifact, and one set of execution semantics. Adding execution behavior
means extending the runner — not adding a service.
