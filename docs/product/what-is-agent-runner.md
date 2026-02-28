# What is Agent Runner?

## One-Sentence Positioning

**Agent Runner is the execution engine that takes an AgentExecution record and turns it into a live AI agent run—processing every LLM call, tool invocation, and status update until the job is done.**

---

## Executive Summary

Agent Runner is a Python background service, not an API resource. It is a [Temporal](https://temporal.io/) activity worker that sits between the Stigmer backend (which manages resources) and the underlying AI execution layer (which runs LangGraph/Graphton agents).

When a user runs `stigmer run my-agent "Review this PR"`, the Stigmer backend creates an `AgentExecution` record and enqueues a Temporal workflow. Agent Runner picks up that workflow's activities, resolves all the resources the agent needs, provisions a workspace, starts the AI model loop, streams events back to the backend in real time, and handles human-in-the-loop approval checkpoints along the way.

If you are working on Stigmer, Agent Runner is the code that actually *runs* agents. Everything else—the CLI, the API, the YAML resources—converges here.

---

## Where Agent Runner Fits in the System

```
User (CLI / API)
      │
      ▼
stigmer-service  ──────► Temporal Workflow (Java)
(gRPC / REST)               │
      ▲                     │  schedules activities on task queue:
      │                     │  "agent_execution_runner"
      │                     ▼
      └─────────── Agent Runner (Python)
                        │
                        ├── resolves resources via gRPC
                        ├── provisions workspace
                        ├── starts Graphton/LangGraph agent
                        ├── streams status updates ──► stigmer-service
                        └── handles HITL approvals
```

The Stigmer backend uses a **polyglot Temporal pattern**: Java handles the durable workflow orchestration and resource management; Python handles the actual AI execution. This separation means the workflow layer is reliable and observable while the execution layer can use the full Python AI ecosystem (LangGraph, LangChain tool integrations, etc.).

---

## The Problem Agent Runner Solves

Running an AI agent is not a simple function call. It involves:

- **Resolving a chain of resources**: An `AgentExecution` points to a `Session`, which points to an `AgentInstance`, which points to an `Agent`, which references `Skill`s and `McpServer`s. All of these must be fetched, merged, and validated before a single LLM token is generated.
- **Provisioning an environment**: The agent may need a Git repository cloned, a local filesystem mounted, or a cloud sandbox spun up—with credentials from the environment chain resolved just in time.
- **Managing conversation state across runs**: A session can span multiple executions. The LangGraph state from the previous turn must be loaded from a checkpointer before the new turn begins.
- **Streaming live progress**: Users expect to see messages and tool calls as they happen, not only when the execution finishes. The backend must receive frequent, incremental status updates.
- **Supporting human-in-the-loop**: Specific tool calls may require human approval before the agent can proceed. The execution must pause, wait, and resume without losing state.

Agent Runner handles all of this. It is the infrastructure layer that makes all of the above work reliably, whether the agent is running locally on SQLite or in production on MongoDB with cloud sandboxes.

---

## Key Components

### Temporal Worker (`worker/worker.py`)

The entry point into Agent Runner's execution logic. It connects to the Temporal server, registers all activities on the `agent_execution_runner` task queue, and blocks until a shutdown signal is received.

It registers four activities:

| Activity | Responsibility |
|---|---|
| `EnsureThread` | Creates or retrieves the LangGraph thread ID for the session. |
| `ExecuteGraphton` | The main execution activity—resolves resources, runs the agent, streams status. |
| `GenerateSessionSubject` | Generates a human-readable title for a session after its first execution. |
| `CleanupSandbox` | Tears down Docker or Daytona sandbox containers after execution. |

### Execute Graphton Activity (`worker/activities/execute_graphton.py`)

This is the core of Agent Runner—a ~3,000-line activity that orchestrates the full execution lifecycle. It runs in ten logical steps:

```
Step 1  Resolve resource chain via gRPC
        AgentExecution → Session → AgentInstance → Agent → Skills → Environments → MCP Servers

Step 2  Initialize workspace backend
        local: FilesystemBackend
        cloud: DaytonaBackend

Step 3  Provision workspace
        git clone (with auth token injection) | local path | empty

Step 4  Extract skills
        Download skill ZIPs from artifact storage
        Extract SKILL.md → inject into agent system prompt

Step 5  Merge environments
        agent.env_spec → environment[0] → … → runtime_env
        Resolve ${VAR} placeholders across MCP server configs

Step 6  Transform MCP servers
        stdio: subprocess configs
        HTTP: URL + auth headers

Step 7  Create checkpointer
        sqlite (local/OSS) | mongodb (cloud, multi-instance safe)

Step 8  Create Graphton agent
        create_deep_agent(instructions, skills, mcp_servers, checkpointer, …)

Step 9  Stream execution events
        Process LangGraph events → build status → send progressive updates via gRPC
        Handle HITL approval checkpoints

Step 10 Return final status
        Delivered back to the Temporal workflow for observability
```

### Sandbox Manager (`worker/sandbox_manager.py`)

Manages where the agent process actually runs. There are three modes:

| Mode | Description | When Used |
|---|---|---|
| `local` | Direct subprocess on the host filesystem | Local development, simple tasks |
| `docker` | Isolated Docker container with TTL-based reuse | Sandboxed local execution |
| `daytona` | Cloud-based Daytona sandbox | Production cloud deployments |

In cloud mode, sandbox containers are reused across executions of the same agent instance to avoid cold-start overhead. When a sandbox is idle beyond its TTL, `CleanupSandbox` tears it down.

### Workspace Provisioner (`worker/workspace/provisioner.py`)

Provisions the working directory that the agent operates in:

- **Git repository**: Clones a repo at the specified ref, injects auth tokens just before cloning, consumes the credential from the environment chain.
- **Local path**: Mounts an existing local directory (local mode only).
- **Empty**: Provides a clean scratch directory when no workspace is needed.

### Checkpointer Factory (`worker/checkpointer/factory.py`)

Creates the LangGraph state persistence layer:

| Type | Storage | Use Case |
|---|---|---|
| `memory` | In-process RAM | Testing only; state is lost after the activity |
| `sqlite` | Local SQLite file | Local/OSS deployments; single-instance safe |
| `mongodb` | MongoDB collection | Cloud deployments; multi-instance safe |

The checkpointer is keyed by thread ID, so a session's conversation history is preserved across multiple `AgentExecution` runs.

### Streaming Update Scheduler (`worker/streaming/update_scheduler.py`)

Controls when Agent Runner sends status updates back to the stigmer-service during execution. It uses a hybrid strategy:

| Trigger | Condition | Purpose |
|---|---|---|
| `FIRST_UPDATE` | First event received | Immediate feedback that execution started |
| `TIME_THRESHOLD` | 500 ms since last update | Rate limiting; prevents flooding |
| `KEEPALIVE` | 5 s with no update sent | Signals the backend that execution is alive |
| `BURST_PROTECTION` | 50 events accumulated | Memory guard during high-event-rate phases |

This means the user sees near-real-time progress without the backend being overwhelmed by every individual LangGraph event.

---

## Execution Modes

Agent Runner supports two top-level modes that change defaults across every subsystem:

### Local Mode (`MODE=local`)

For OSS users and local development. No cloud dependencies required.

- Checkpointer: SQLite (`./checkpoints/langgraph.db`)
- Workspace: Local filesystem (`./workspace`)
- Sandbox: Direct subprocess or Docker (no Daytona)
- LLM: Ollama (`qwen2.5-coder:7b`)
- Backend: `localhost:50051`

### Cloud Mode (`MODE=cloud`)

For Stigmer Cloud deployments.

- Checkpointer: MongoDB
- Workspace: Daytona cloud sandboxes
- LLM: Anthropic (`claude-sonnet-4.5`)
- Artifact storage: Cloudflare R2
- Backend: internal gRPC endpoint with API key auth

The same codebase runs in both modes—only the `Config` changes.

---

## Configuration Reference

Key environment variables:

| Variable | Description | Local Default | Cloud Default |
|---|---|---|---|
| `MODE` | `local` or `cloud` | `cloud` | `cloud` |
| `TEMPORAL_SERVICE_ADDRESS` | Temporal server address | `localhost:7233` | — |
| `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE` | Task queue name | `agent_execution_runner` | `agent_execution_runner` |
| `STIGMER_BACKEND_ENDPOINT` | gRPC endpoint for stigmer-service | `localhost:50051` | `localhost:8080` |
| `STIGMER_API_KEY` | Auth key for gRPC | not required | required |
| `STIGMER_LLM_PROVIDER` | `anthropic`, `ollama`, or `openai` | `ollama` | `anthropic` |
| `STIGMER_LLM_MODEL` | Model name | `qwen2.5-coder:7b` | `claude-sonnet-4.5` |
| `STIGMER_LLM_API_KEY` | LLM provider API key | not required | required |
| `STIGMER_CHECKPOINTER_TYPE` | `memory`, `sqlite`, or `mongodb` | `sqlite` | `mongodb` |
| `STIGMER_CHECKPOINTER_SQLITE_PATH` | SQLite file path | `./checkpoints/langgraph.db` | — |
| `STIGMER_CHECKPOINTER_MONGODB_URI` | MongoDB URI | — | required |
| `SANDBOX_TYPE` | `filesystem` or `daytona` | `filesystem` | `daytona` |
| `STIGMER_EXECUTION_MODE` | `local`, `sandbox`, or `auto` | `local` | `local` |
| `STREAMING_MIN_INTERVAL_MS` | Min ms between status updates | `500` | `500` |
| `STREAMING_MAX_INTERVAL_MS` | Max ms before forced keepalive | `5000` | `5000` |

---

## How It Fits With the Agent Resource Stack

Agent Runner does not define resources—it *executes* them. Every resource in the Agent stack maps to something Agent Runner does:

| API Resource | What Agent Runner Does With It |
|---|---|
| `Agent` | Reads `spec.instructions`, `mcp_server_usages`, `skill_refs`, `sub_agents` |
| `AgentInstance` | Reads environment bindings; resolves credentials for workspace and MCP servers |
| `Session` | Looks up the LangGraph thread ID; loads prior conversation state via the checkpointer |
| `AgentExecution` | The top-level trigger; its ID drives the entire execution; Agent Runner writes status updates back to it |
| `Skill` | Downloads ZIP artifacts; extracts `SKILL.md`; injects into the system prompt |
| `McpServer` | Translates resource config into Graphton `stdio` or `http` server configs; resolves `${VAR}` placeholders |

---

## Running Agent Runner Locally

```bash
cd backend/services/agent-runner

# Install dependencies
pip install -e ".[dev]"

# Configure for local mode
export MODE=local
export STIGMER_LLM_PROVIDER=ollama
export STIGMER_LLM_MODEL=qwen2.5-coder:7b

# Start (requires local Temporal server and stigmer-service)
python main.py
```

For a full local stack, use the `docker-compose.yml` at the repo root. Agent Runner, Temporal, stigmer-service, and all dependencies are wired together.

---

## Further Reading

- [Agent Execution Lifecycle](../architecture/agent-execution-lifecycle.md) — Phases, pause/resume/cancel, checkpoint preservation
- [What is an AgentExecution?](what-is-agent-execution.md) — The API resource that Agent Runner processes
- [What is an Agent?](what-is-agent.md) — The blueprint that Agent Runner executes
- [Agent Runner source](../../backend/services/agent-runner/) — The implementation
