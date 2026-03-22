# What is Stigmer Server?

## One-Sentence Positioning

**Stigmer Server is the central backend that owns every API resource—agents, workflows, skills, environments, executions—and coordinates all the other services (Agent Runner, Workflow Runner, Temporal) that bring them to life.**

---

## Executive Summary

Stigmer Server is the API backbone of the Stigmer platform. It is the gRPC server the CLI talks to when you run `stigmer apply`, `stigmer run`, or `stigmer list agents`. It stores every resource, validates every request, triggers executions via Temporal, supervises the execution workers, and streams live execution status back to callers.

There are two implementations of this component:

| | **Stigmer Server** (OSS) | **Stigmer Service** (Cloud) |
|---|---|---|
| Repo | `stigmer/stigmer` | `stigmer/stigmer-cloud` |
| Language | Go | Java (Spring Boot) |
| Storage | SQLite | MongoDB |
| Auth | None (single-user local) | Auth0 + OpenFGA |
| Multi-tenancy | No | Yes (Organizations) |
| Deployment | Local binary | Kubernetes |

They share the same protobuf API contracts (defined in `stigmer/stigmer/apis/`) and the same conceptual resource model. The OSS version is what runs when you use Stigmer locally; the Cloud version is what powers Stigmer Cloud. This document covers the OSS version in depth and includes a section on what changes in the Cloud version for contributors who work on both.

---

## Where Stigmer Server Fits in the System

```
User
  │
  ├── stigmer CLI ──────────────────► Stigmer Server (gRPC :7234)
  │                                          │
  └── SDK / direct gRPC                      ├── SQLite (~/.stigmer/stigmer.db)
                                             │
                                             ├── Temporal ──► Workflow-Runner (Go)
                                             │                      │
                                             │               Agent-Runner (Python)
                                             │
                                             ├── Local filesystem (~/.stigmer/storage)
                                             │   (skill artifacts, execution outputs)
                                             │
                                             └── HTTP file server (:7235)
                                                 (artifact downloads)
```

Stigmer Server is the only process the CLI speaks to directly. Everything else—Temporal, Workflow Runner, Agent Runner—is an implementation detail that Stigmer Server manages. A contributor never needs to start Workflow Runner or Agent Runner manually; Stigmer Server's supervisor launches them.

---

## Key Responsibilities

### 1. Resource Management

Every Stigmer API resource is stored, versioned, and served by Stigmer Server:

- **Agentic**: `Agent`, `AgentInstance`, `AgentExecution`, `Session`
- **Automation**: `Workflow`, `WorkflowInstance`, `WorkflowExecution`
- **Platform**: `Skill`, `McpServer`, `Environment`, `ExecutionContext`, `Project`

Storage uses a **generic single-table pattern**: all resources go into one SQLite table as JSON documents, keyed by type and ID. There are no per-resource schema migrations. Adding a new field to a proto is all that is needed—the store handles it.

### 2. gRPC API Surface

Every resource exposes two gRPC controllers following the CQRS pattern:

| Controller type | Examples | What it handles |
|---|---|---|
| **Command** | `AgentCommandController`, `WorkflowCommandController` | Create, update, delete, trigger |
| **Query** | `AgentQueryController`, `WorkflowQueryController` | Get, List, Subscribe |

There is also a unified `SearchService` that runs FTS5 full-text search across agents, skills, workflows, and MCP servers.

Stigmer Server exposes **gRPC only**—no REST, no GraphQL. The CLI and SDK speak gRPC directly.

### 3. Execution Orchestration

When you trigger an agent or workflow execution, Stigmer Server:

1. Creates an `AgentExecution` or `WorkflowExecution` record in SQLite.
2. Starts a Temporal workflow (via its embedded Temporal client) that drives the execution lifecycle.
3. The Temporal workflow schedules activities on the `agent_execution_runner` or `workflow_execution_runner` task queues.
4. Agent Runner and Workflow Runner pick up those activities and do the actual work.
5. They call back into Stigmer Server via gRPC to stream progressive status updates.
6. The caller can subscribe to `AgentExecution` or `WorkflowExecution` via server-streaming gRPC to receive live updates.

Temporal is optional at startup. If Temporal is unavailable, Stigmer Server starts in degraded mode—resource management works, but executions cannot be triggered.

### 4. Component Supervision

In local mode, Stigmer Server acts as a process supervisor for the other services. It starts and monitors:

- **Workflow Runner** — as a child Go process
- **Agent Runner** — as a Docker container

If either crashes, the supervisor restarts it automatically. Logs from both are routed to `~/.stigmer/logs/`. A contributor never needs to start these manually; `stigmer server start` is all that is needed.

### 5. Artifact Storage

Skills are packaged as ZIP artifacts. Agent executions can produce file outputs and receive file attachments. Stigmer Server manages all of this:

- **Local mode** (default): stored under `~/.stigmer/data/`, served over HTTP on `:7235`
- **Cloud mode** (optional): uploaded to Cloudflare R2

The HTTP file server exists purely so Agent Runner (running in a Docker container) can download skill artifacts at runtime without needing direct filesystem access.

### 6. Full-Text Search

At startup, Stigmer Server rebuilds an FTS5 search index over all existing resources. The `SearchService` gRPC endpoint allows the CLI and UI to search across agents, skills, workflows, and MCP servers by name, description, and tags in a single query.

---

## Architecture Decisions Worth Knowing

### In-Process gRPC

The CLI communicates with Stigmer Server over a network gRPC socket (`:7234`). Internally, when one controller needs to call another—for example, the `AgentExecutionController` needs to fetch the parent `Agent`—it also uses gRPC, but over a Unix-domain or loopback in-process connection.

This means the full gRPC interceptor stack (request validation, logging, error mapping) applies to both external and internal calls. There is no "internal shortcut" that skips validation. The tradeoff is a small amount of overhead; the benefit is that bugs in inter-controller calls are caught the same way as bugs in external calls.

### No Auth in OSS

The OSS version has no authentication or authorization. It is designed for a single user on a local machine. All resources are returned without filtering; all commands are accepted without checking identity. Comments throughout the codebase mark the places where a cloud deployment would call the IAM Policy service—these are explicitly left as no-ops in OSS.

### Generic Storage, No Migrations

The SQLite store uses a single `resources` table with columns for type, ID, and a JSON blob. There is no schema migration tooling and no ORM. Adding fields to protos does not require a migration—the JSON blob just gets the new field at the next write. This makes the OSS storage layer extremely easy to work with locally.

---

## End-to-End: What Happens When You Run `stigmer run my-agent "Hello"`

```
1. CLI sends CreateAgentExecution + StartExecution (gRPC → :7234)

2. Stigmer Server
   ├── Creates AgentExecution record in SQLite
   ├── Starts InvokeAgentExecutionWorkflow (Temporal)
   └── Subscribes caller to AgentExecution status stream

3. Temporal Workflow (Java, in cloud; Go stub in OSS)
   └── Schedules EnsureThread activity → agent_execution_runner queue

4. Agent Runner (Python, Docker)
   ├── EnsureThread: creates/retrieves LangGraph thread ID
   ├── ExecuteGraphton:
   │   ├── Fetches AgentExecution → Session → AgentInstance → Agent
   │   │   (via gRPC → Stigmer Server :7234)
   │   ├── Provisions workspace, extracts skills
   │   ├── Starts Graphton/LangGraph agent
   │   └── Streams events → sends UpdateStatus (gRPC → :7234)
   │
5. Stigmer Server receives UpdateStatus
   └── Writes new status to SQLite
   └── Pushes update to all active status subscribers

6. CLI subscriber receives status updates and prints them live
```

---

## Configuration Reference

| Variable | Description | Default |
|---|---|---|
| `GRPC_PORT` | gRPC server port | `7234` |
| `ARTIFACT_HTTP_PORT` | HTTP artifact file server port | `GRPC_PORT + 1` |
| `DB_PATH` | SQLite database path | `~/.stigmer/stigmer.db` |
| `STORAGE_PATH` | Skill artifact storage path | `~/.stigmer/storage` |
| `LOG_LEVEL` | Log level: `debug`, `info`, `warn`, `error` | `info` |
| `ENV` | Environment: `local`, `dev`, `prod` | `local` |
| `TEMPORAL_HOST_PORT` | Temporal server address | `localhost:7233` |
| `TEMPORAL_NAMESPACE` | Temporal namespace | `default` |
| `ARTIFACT_STORAGE_TYPE` | `local` or `r2` | `local` |
| `ARTIFACT_LOCAL_BASE_PATH` | Local artifact root | `~/.stigmer/data` |
| `STIGMER_LLM_PROVIDER` | LLM provider for Agent Runner | `ollama` |
| `STIGMER_LLM_MODEL` | LLM model for Agent Runner | `qwen2.5-coder:14b` |
| `STIGMER_LLM_BASE_URL` | Ollama base URL | `http://localhost:11434` |
| `STIGMER_EXECUTION_MODE` | Agent execution mode: `local`, `sandbox` | `local` |

---

## Running It Locally

The recommended way is via the CLI, which starts Stigmer Server and all dependencies:

```bash
stigmer server start
```

To run the binary directly (for development):

```bash
cd backend/services/stigmer-server

# Configure
export DB_PATH=~/.stigmer/stigmer.db
export TEMPORAL_HOST_PORT=localhost:7233

# Start
go run cmd/server/main.go
```

For the full local stack (Stigmer Server, Temporal, Agent Runner, Workflow Runner):

```bash
# From the repo root
docker compose up
```

---

## In Stigmer Cloud: `stigmer-service`

The Cloud equivalent is `stigmer-service`, a Java/Spring Boot gRPC server in the `stigmer/stigmer-cloud` repo. The two share the same protobuf API contracts—the CLI does not know or care which it is talking to. The Cloud version adds:

### Multi-Tenancy
All resources are scoped to an **Organization**. Every API call carries an org context. Resources from one org are never visible to another.

### Full IAM
The Cloud version ships the IAM domain that is intentionally absent from OSS:
- **Identity Accounts** — user identities synced from Auth0
- **API Keys** — long-lived programmatic credentials for CLI/SDK
- **IAM Policies** — fine-grained per-resource authorization rules
- **Identity Providers** — SSO and OAuth provider configuration

Authorization uses **OpenFGA** for relationship-based access control. Every query controller filters results through a permission check; every command controller validates that the caller has the right to perform the action.

### Different Infrastructure
| | OSS | Cloud |
|---|---|---|
| Storage | SQLite | MongoDB |
| Artifact storage | Local filesystem | Cloudflare R2 |
| Worker supervision | In-process supervisor | Separate Kubernetes pods |
| Event propagation | None (no-op) | Event publishing on resource changes |
| Temporal | Optional | Required |

### Proto Sharing
The Cloud repo does not redefine any proto files. It imports them from the OSS repo via git tag references (e.g. `v0.0.7`). All API changes start in `stigmer/stigmer/apis/` and flow into the Cloud version via a version bump.

---

## Further Reading

- [What is an Agent?](what-is-agent.md) — The most important resource Stigmer Server manages
- [What is an AgentExecution?](what-is-agent-execution.md) — The runtime record for every agent run
- [What is Agent Runner?](what-is-agent-runner.md) — The worker Stigmer Server supervises for agent executions
- [What is Workflow Runner?](what-is-workflow-runner.md) — The worker Stigmer Server supervises for workflow executions
- [Stigmer Server source](../../backend/services/stigmer-server/) — OSS implementation
