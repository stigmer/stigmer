# What is a Session?

## One-Sentence Positioning

**A Session is a persistent, named conversation context for an agent—the same way a terminal session is a persistent environment where you run multiple commands and each one builds on the last.**

---

## Executive Summary

A Session is Stigmer's third runtime layer. It is the container for a multi-turn conversation with an agent: it holds the message thread that gives the agent memory across multiple runs, and it optionally provisions a persistent workspace—a sandbox with files the agent can read and write throughout the entire conversation.

The Session sits between AgentInstance and AgentExecution in the four-layer stack:

```
Agent ──► AgentInstance ──► Session ──► AgentExecution
```

The Agent is the *blueprint*. The AgentInstance is the *binding* of that blueprint to an environment with credentials. The Session is the *context*—the ongoing conversation. The AgentExecution is the *turn*—a single message and its response.

You never author a Session the way you author an Agent. Sessions are lightweight runtime artifacts. You create one when you want to start a conversation, pass its ID when triggering executions, and delete it when the conversation is over. In the common case, the platform creates the session for you automatically when you send your first message.

What makes Sessions powerful is persistence. Files the agent creates in the first turn are still there in the tenth. The full message history is carried forward in every turn. The agent has true continuity—not just a stateless API call, but a working environment that accumulates context over time.

---

## The Problem Sessions Solve

### Multi-Turn AI Interactions Are Stateless by Default

A standard LLM API gives you one response per call. Every call starts fresh. There is no built-in concept of "continue this conversation" or "the agent should remember what it did last time."

**What goes wrong without a session layer:**

- You send the agent a message to "analyze this codebase." It produces a report. You send a follow-up: "now fix the three critical issues." The agent has no memory of what it analyzed.
- The agent creates a file during a run. You ask it to update that file in a follow-up. Without a persistent workspace, the file is gone—the sandbox was thrown away when the first run ended.
- You are running a long refactoring task across twenty turns. Without a session, you must manually pass the full conversation history in every API call. The payload grows indefinitely and eventually hits context limits.
- You want to audit what a specific conversation produced—which tool calls, which files, which decisions. Without a session boundary, executions are a flat list with no grouping.

### The Hidden Cost of DIY Session Management

Teams that build their own session management layer end up solving the same problems repeatedly:

- **Thread management**: serializing and re-injecting conversation history. Gets expensive as threads grow.
- **Workspace lifecycle**: provisioning a sandbox on first call, reattaching to it on subsequent calls, cleaning it up when done. Fragile in practice.
- **Execution grouping**: correlating multiple API calls to the same "conversation" for audit, billing, and debugging.
- **Context limits**: knowing when the thread is approaching the model's context window and summarizing or truncating appropriately.

Stigmer's Session resource handles all of this. You create the session once; the platform handles thread persistence, sandbox reuse, and lifecycle management for every turn within it.

---

## The Stigmer Session

### One Context. Unlimited Turns.

A Session holds everything the agent needs to maintain continuity across an unlimited number of executions:

```bash
# Create a session tied to an agent instance
stigmer session create --agent-instance agi_abc123 --subject "Q1 refactoring"

# Send the first message — execution runs within that session
stigmer run --session ses_xyz789 "Analyze the authentication module for security issues"

# Follow-up — same session, full memory of the previous turn
stigmer run --session ses_xyz789 "Fix the three critical issues you identified"

# Another follow-up — the agent still has the files it created
stigmer run --session ses_xyz789 "Write tests for the fixes and open a PR"
```

The agent in the third turn knows what it analyzed, what it fixed, and where the files are. No manual context passing. No workspace teardown between turns.

### What the YAML Looks Like

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Session
metadata:
  name: q1-refactor-auth
  org: acme-corp
spec:
  # The AgentInstance this session runs against (required).
  # The instance provides all secrets and environment bindings.
  agent_instance_id: agi_abc123

  # Human-readable subject for UI display (optional).
  subject: "Q1 authentication module refactoring"

  # Optional workspace: clone a git repo into the agent's sandbox.
  # Provisioned once on the first execution; reused for all subsequent turns.
  workspace_source:
    git_repo:
      url: "https://github.com/acme/backend.git"
      branch: "main"
```

Apply it. Run in it. Delete it when done.

---

## Architecture: Where Sessions Fit

### The Four Layers

```
Agent ──► AgentInstance ──► Session ──► AgentExecution
```

| Layer | Analogy | What It Does |
|---|---|---|
| **Agent** | Docker image | Declares capabilities and configuration. Immutable template. You author this in YAML. |
| **AgentInstance** | Container config | Binds the Agent to an environment—provides secrets, credentials, and runtime values. |
| **Session** | Terminal session | Groups related executions into a conversational context. Maintains message history and workspace state across runs. |
| **AgentExecution** | `docker run` | A single invocation of an agent instance within a session. Produces messages, tool calls, and results. |

**Why this separation matters:**

The Session is the boundary between "design time" and "runtime" on one hand, and between individual executions on the other. You can have one Agent, multiple AgentInstances (dev vs. production), and within each instance, many Sessions (one per feature branch, one per customer, one per project). Within each session, every turn builds on the last.

### How Sessions Are Created

Sessions are created in two ways:

**Explicitly** — You create a session via the CLI or API, then pass the `session_id` when triggering executions. Use this when you want to name the conversation, attach a workspace source, or group executions intentionally.

**Automatically** — When you trigger an execution with only an `agent_id` (no `session_id`), the platform auto-creates a session bound to the agent's default instance. The session ID is returned in the execution response. Use this for quick, one-off runs.

---

## The Two Pillars of a Session

### 1. Thread Continuity (Message History)

The Session holds a `thread_id` that is generated on the first execution and persists for the life of the session. Every AgentExecution within the session appends to this thread.

```
Session ses_xyz789
│
├── AgentExecution 1 (thread_id: thd_001)
│   ├── User: "Analyze the auth module"
│   └── Agent: "Found 3 critical issues: ..."
│
├── AgentExecution 2 (same thread_id: thd_001)
│   ├── User: "Fix the critical issues"
│   └── Agent: "Fixed CVE-2024-001, CVE-2024-002, CVE-2024-003"
│
└── AgentExecution 3 (same thread_id: thd_001)
    ├── User: "Write tests for the fixes"
    └── Agent: "Created test_auth.py with 12 test cases"
```

The agent in execution 3 has full memory of everything that happened in executions 1 and 2. It knows what it analyzed, what it fixed, and what files it created — because all of it is in the shared thread.

### 2. Workspace Persistence (Sandbox)

The Session optionally provisions a Daytona sandbox — an isolated execution environment with a filesystem. The sandbox is created on the first execution and **reused for every subsequent execution** in the session.

```
Session ses_xyz789
│
├── sandbox_id: snb_abc123 (created on first execution)
│
├── AgentExecution 1: creates /workspace/analysis.md
├── AgentExecution 2: edits /workspace/auth.py, creates /workspace/patch.diff
└── AgentExecution 3: reads /workspace/patch.diff, creates /workspace/test_auth.py
```

Files created in turn one are visible in turn ten. The workspace accumulates state the same way your terminal session's filesystem accumulates state between commands.

**Workspace Sources**

When creating a session, you can declare where the workspace content comes from:

```yaml
# Clone a git repository (works in local and cloud modes)
workspace_source:
  git_repo:
    url: "https://github.com/acme/backend.git"
    branch: "feature/auth-refactor"
    # Optional: pin to a specific commit
    commit: "a1b2c3d4"
    # Optional: clone depth (default: 1 for fast shallow clone; 0 for full history)
    depth: 1

# Use a local directory directly (local mode only)
workspace_source:
  local_path:
    path: "/Users/dev/projects/acme-backend"
```

When no `workspace_source` is specified, the agent runs in an empty sandbox directory — the existing default behavior, fully backward-compatible.

**GitRepoSource constraints:**
- HTTPS URLs only (`https://`). SSH is not supported.
- Authentication via `GITHUB_TOKEN` from the merged environment — the token is consumed by provisioning and not forwarded to the agent runtime.
- Branch and commit can be combined: clone the branch, then check out the exact commit.

**LocalPathSource constraints:**
- Only valid in local mode (the agent-runner running on the same machine as the path).
- Cloud runners reject `local_path` at provisioning time with a clear error.
- No copy is made — the agent operates directly on your files.

---

## Session Lifecycle

### States

A Session is a passive resource — it has no "running" or "paused" state of its own. The lifecycle of activity within a session belongs to its AgentExecutions.

| Session State | Description |
|---|---|
| **Active** | The session exists and can receive new executions. |
| **Deleted** | The session has been deleted. Its thread and sandbox are cleaned up. Executions that ran within it remain in the audit log but are no longer grouped. |

### Deleting a Session

Deleting a session cleans up the associated thread and sandbox. Executions that ran within the session remain in the audit log for compliance purposes — you do not lose the execution history, only the grouping.

```bash
stigmer session delete ses_xyz789
```

---

## Common Patterns

### Pattern 1: Explicit Session with a Git Workspace

Create the session first, attach a repository, then run multiple turns within it.

```yaml
# session.yaml
apiVersion: agentic.stigmer.ai/v1
kind: Session
metadata:
  name: backend-security-review
  org: acme-corp
spec:
  agent_instance_id: agi_abc123
  subject: "Backend security review — Q1 2026"
  workspace_source:
    git_repo:
      url: "https://github.com/acme/backend.git"
      branch: "main"
```

```bash
stigmer apply -f session.yaml
stigmer run --session backend-security-review "Run a full security audit of the codebase"
stigmer run --session backend-security-review "Generate a report with CVSS scores for each finding"
stigmer run --session backend-security-review "Create GitHub issues for all critical findings"
```

### Pattern 2: Auto-Session for Quick Runs

No session management required — the platform creates and manages the session for you.

```bash
# Session auto-created; session_id returned in execution response
stigmer run my-agent "What is the status of our Kubernetes cluster?"
```

### Pattern 3: Session Per Customer

Create one session per customer conversation. Each session maintains a separate thread and workspace.

```bash
stigmer session create --agent-instance agi_support --subject "Customer: Acme Corp onboarding"
stigmer session create --agent-instance agi_support --subject "Customer: Globex Corp incident"
```

### Pattern 4: Local Development with a Project Directory

Use your local project files directly — no clone required.

```yaml
spec:
  agent_instance_id: agi_local_dev
  subject: "Refactoring my-app"
  workspace_source:
    local_path:
      path: "/Users/dev/projects/my-app"
```

---

## How It Compares

| Without Sessions | With Stigmer Sessions |
|---|---|
| Pass full conversation history in every API call | Thread managed automatically; history persists across turns |
| Sandbox torn down after each run; files lost | Workspace persists across all executions within the session |
| No concept of a "conversation" — all executions are a flat list | Executions grouped by session; filter by session in audit logs |
| DIY workspace provisioning from a git repo on every run | Declare `workspace_source` once; provisioned and reused automatically |
| Multi-turn coordination requires custom orchestration | Send messages to the same session ID; continuity is built in |

---

## Getting Started

```bash
# 1. List your agent instances to find an instance ID
stigmer agentinstance list

# 2. Create a session (or skip this and let the platform auto-create one)
stigmer session create \
  --agent-instance agi_abc123 \
  --subject "My first multi-turn conversation"

# 3. Run the first turn
stigmer run --session ses_xyz789 "Hello! What can you help me with?"

# 4. Run a follow-up in the same session (agent remembers the first turn)
stigmer run --session ses_xyz789 "Great. Now let's start with the codebase."

# 5. List all sessions
stigmer session list

# 6. List sessions for a specific agent
stigmer session list --agent agt_abc123

# 7. Delete a session when the conversation is complete
stigmer session delete ses_xyz789
```

---

## Further Reading

- [Session Resource Guide](../../apis/ai/stigmer/agentic/session/docs/session-resource-guide.md) — Complete YAML schema, all spec fields, CLI commands
- [Workspace Sources](../../apis/ai/stigmer/agentic/session/docs/workspace-sources.md) — Git repo and local path provisioning, authentication, branch/commit pinning
- [Conversation Continuity](../../apis/ai/stigmer/agentic/session/docs/conversation-continuity.md) — Thread identity, history across executions, context window interaction
- [What is an AgentExecution?](what-is-agent-execution.md) — The single run that happens within a session
- [What is an AgentInstance?](what-is-agent-instance.md) — The environment binding a session is tied to
- [What is an Agent?](what-is-agent.md) — The blueprint at the top of the stack
- [Agent Execution Lifecycle](../architecture/agent-execution-lifecycle.md) — Phases, pause/resume/cancel, checkpoint preservation
