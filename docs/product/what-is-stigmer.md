# What is Stigmer?

## One-Sentence Positioning

**Stigmer is an open-source platform for building, running, and managing AI agents and automation workflows — the same way Kubernetes is a platform for building, running, and managing containerized workloads.**

---

## Executive Summary

Stigmer is an infrastructure platform that gives AI agents the same operational rigor that Kubernetes gave to containers: declarative definitions, versioning, environment separation, access control, durable execution, and a marketplace for sharing.

You define an agent in YAML — its instructions, its tools, its domain knowledge, its sub-agents. You apply it with `stigmer apply`. You run it with `stigmer run`. The same YAML works on your laptop with SQLite and Ollama, or in production on Stigmer Cloud with MongoDB, Anthropic, and full team management. The definition never changes. Only the environment binding does.

Stigmer is not a framework for writing LLM calls. It is the layer above that: the platform that manages the agent's entire lifecycle — from authoring and versioning, through credential binding and execution, to audit trails and cost tracking. It does the same for deterministic automation workflows, which can call agents as first-class steps.

The platform ships as a single CLI binary (`stigmer`) that embeds everything needed to run locally: a gRPC server, a Temporal orchestration engine, an AI execution runtime, and a set of built-in system agents that help you create more agents. No Docker required. No cloud account required. Install and go.

---

## The Problem Stigmer Solves

### AI Agents Are Built Without Infrastructure

Most teams build AI agents by hardcoding everything into application code:

```python
client = anthropic.Anthropic()
response = client.messages.create(
    model="claude-sonnet-4.5",
    system="You are a code review assistant...",
    tools=[github_tool, slack_tool],
    messages=[{"role": "user", "content": user_input}],
)
```

This works for a proof of concept. It breaks at team scale because there is no infrastructure around the agent:

- **No versioning.** The system prompt lives in a Python file. There is no history of how it evolved, no way to roll back, no diff when a teammate changes it.
- **No separation of concerns.** Credentials are embedded alongside instructions. Running the same agent against staging and production means duplicating code or adding environment-selection logic.
- **No reuse.** Every team builds the same patterns from scratch. There is no library of agents the way Docker Hub is a library of container images.
- **No composition standard.** Multi-agent systems require bespoke orchestration code that is the same every time, but written from scratch every time.
- **No observability.** When an agent makes a destructive tool call, there is no record of what happened, no approval gate before it happens, and no way to stop it mid-run.
- **No portability.** An agent built for local development cannot be promoted to production without changing application code.

Stigmer exists to solve all of these problems with a single, coherent platform.

---

## What Stigmer Provides

### 1. A Declarative Resource Model

Every concept in Stigmer is a YAML resource with a standard structure: `apiVersion`, `kind`, `metadata`, `spec`, and `status`. You author the spec. The system manages the status.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  org: acme-corp
spec:
  description: "Reviews code for quality, security, and best practices"
  instructions: |
    You are a code review assistant. For every review:
    1. Check for security vulnerabilities
    2. Evaluate code quality
    3. Suggest actionable improvements

  mcp_server_usages:
    - mcp_server_ref:
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_review_comment

  skill_refs:
    - slug: company-style-guide
```

This is not configuration for a framework. It is a portable, versionable, shareable artifact — the same way a Kubernetes manifest is a portable, versionable, shareable artifact.

### 2. Separation of Blueprint from Runtime

Stigmer enforces a clean separation between what an agent does and where it runs:

```
Agent (blueprint) ──► AgentInstance (environment binding) ──► Session (conversation) ──► AgentExecution (single run)
```

- The **Agent** declares capabilities: instructions, tools, knowledge, sub-agents. No secrets. No environment-specific values.
- The **AgentInstance** binds the Agent to an environment — production credentials, staging API keys, per-customer tokens. Same blueprint, different bindings.
- The **Session** maintains conversation context across multiple turns — message history and a persistent workspace where the agent reads and writes files.
- The **AgentExecution** is a single run within a session — one user message, one agent response, with full tool call audit trails.

The same pattern applies to automation workflows: Workflow → WorkflowInstance → WorkflowExecution.

### 3. Four Building Blocks for Agents

Every agent is composed from four building blocks, each managed as an independent, versionable resource:

| Building Block | What It Is | Stigmer Resource |
|---|---|---|
| **Instructions** | The system prompt — what the agent does and how it behaves | Inline in the Agent spec |
| **Tools** | External system integrations the agent can call (GitHub, Slack, databases) | `McpServer` — portable, versioned tool integration definitions following the Model Context Protocol |
| **Knowledge** | Domain expertise the agent carries (style guides, runbooks, procedures) | `Skill` — content-addressed packages with a `SKILL.md` injected into the agent's context at runtime |
| **Delegation** | Specialized sub-agents the parent can dispatch work to | Sub-agents declared inline, with restricted tool access inherited from the parent |

Each building block is independently authored, versioned, and shareable. A platform team publishes a GitHub MCP server once; every agent in the organization references it. A security team publishes a review checklist skill; every code review agent picks it up.

### 4. Durable, Observable Execution

Every agent and workflow execution is backed by [Temporal](https://temporal.io/), providing durability guarantees that no script or job runner can match:

- **Full lifecycle control.** Pause, resume, cancel, terminate, and recover executions without losing completed work.
- **Human-in-the-loop approvals.** Configure specific tool calls to require human approval before they execute. The execution pauses, waits for a decision, and continues.
- **Checkpoint-based recovery.** If an execution fails due to a transient error, recover from the last checkpoint — completed tool calls are not re-executed.
- **Complete audit trails.** Every message, every tool call, every sub-agent invocation is recorded with timestamps, arguments, and results.
- **Real-time streaming.** Watch execution progress live from the CLI or API — messages and tool calls appear as they happen.
- **Token usage tracking.** Every execution reports prompt tokens, completion tokens, LLM call count, and the model used.

### 5. Works Locally, Scales to Cloud

Stigmer has two implementations that share the same protobuf API contracts and the same CLI:

| | **Stigmer (OSS)** | **Stigmer Cloud** |
|---|---|---|
| Language | Go server + Python agent runner | Java server + Python agent runner |
| Storage | SQLite | MongoDB |
| Auth | None (single-user local) | Auth0 + OpenFGA |
| Multi-tenancy | No | Yes (Organizations) |
| LLM | Ollama (local models) | Anthropic, OpenAI |
| Deployment | Single binary on your laptop | Kubernetes |

The same YAML, the same CLI commands, the same agent definitions work in both modes. The only thing that changes is the backend configuration — and that is handled by the AgentInstance, not the Agent.

```bash
# Local — SQLite, Ollama, no server required
stigmer apply -f agent.yaml
stigmer run my-agent "Review this PR"

# Production — same commands, same YAML, cloud backend
stigmer apply -f agent.yaml
stigmer run my-agent "Review this PR"
```

### 6. Deterministic Workflows That Call Agents

For automation that must be predictable, auditable, and reproducible — deployment pipelines, data processing jobs, approval sequences — Stigmer provides Workflows. Workflows are declarative YAML pipelines with 13 task types: HTTP calls, gRPC calls, conditional branching, parallel execution, loops, signal-based waits, and agent invocations.

An agent *thinks*. A workflow *orchestrates*. The two compose naturally: a workflow controls the pipeline; agents handle the steps that require reasoning.

```yaml
tasks:
  - name: analyzeIncident
    kind: agent_call
    task_config:
      agent: "incident-analyzer"
      message: "Analyze this incident: ${$context.fetchReport.body}"
    flow:
      then: createTicket

  - name: createTicket
    kind: http_call
    task_config:
      method: POST
      endpoint:
        uri: "${.env.JIRA_URL}/issues"
      body:
        description: "${$context.analyzeIncident}"
```

Workflows are durable — a server restart resumes from the last completed task. Waits for human approval or external events consume zero resources. Every step is recorded in Temporal's event history.

### 7. Multi-Tenancy, Access Control, and a Marketplace

Organizations are the root namespace for all Stigmer resources. Every agent, workflow, MCP server, skill, and session belongs to exactly one organization. Nothing crosses organization boundaries without an explicit reference.

Access control is built on [OpenFGA](https://openfga.dev/) — a relationship-based authorization engine. IAM Policies bind principals (users, teams, machine accounts) to permissions on resources. Identity Providers enable federated authentication so external platforms can let their users access Stigmer without creating a separate account.

Public resources — agents, skills, MCP servers — can be published to the Stigmer marketplace. Anyone can reference a public agent by its `org/slug`, the same way you pull a Docker image by its registry path.

### 8. Zero-Config Getting Started

The CLI binary embeds a **seedpack** — a complete Stigmer project containing system agents, skills, and MCP servers. When you start the server for the first time, the seedpack is applied automatically. From that point on, commands like `stigmer draft agent` work because the agents and skills that power them are already there.

No Docker. No external database. No cloud account. Install the CLI and go.

```bash
# Install and start
stigmer server start

# Create your first agent
stigmer apply -f my-agent.yaml

# Run it
stigmer run my-agent "Hello, what can you do?"
```

---

## The Resource Model at a Glance

```
Organization (root namespace)
│
├── Agents (AI worker blueprints)
│   ├── AgentInstances (environment bindings)
│   │   └── Sessions (conversation contexts)
│   │       └── AgentExecutions (single runs)
│   └── Sub-Agents (inline delegation)
│
├── Workflows (deterministic automation pipelines)
│   ├── WorkflowInstances (environment bindings)
│   └── WorkflowExecutions (single runs)
│
├── MCP Servers (tool integrations — GitHub, Slack, databases, APIs)
│
├── Skills (versioned domain knowledge packages)
│
├── Environments (encrypted credential stores)
│
├── Projects (managed resource groupings with orphan pruning)
│
└── IAM (Identity Accounts, API Keys, IAM Policies, Identity Providers)
```

Every resource follows the same pattern: declarative YAML, versioned on every change, with full audit trails (who changed what, when).

---

## The Runtime Architecture

```
User
  │
  ├── stigmer CLI ──────────► Stigmer Server (gRPC)
  │                                  │
  └── SDK / direct gRPC              ├── Storage (SQLite or MongoDB)
                                     │
                                     ├── Temporal ──► Workflow Runner (Go)
                                     │                     │
                                     │               Agent Runner (Python)
                                     │
                                     └── Artifact Storage (local or R2)
```

- **Stigmer Server** owns every API resource and coordinates execution.
- **Temporal** provides durable workflow orchestration.
- **Agent Runner** is a Python service that runs AI agents using LangGraph, with full MCP server integration, skill injection, and checkpoint-based state management.
- **Workflow Runner** is a Go service that interprets CNCF Serverless Workflow definitions, executing HTTP calls, gRPC calls, agent invocations, and control flow tasks.

Both runners are managed by the CLI's background daemon — `stigmer server start` launches everything.

---

## How Stigmer Compares

| Without Stigmer | With Stigmer |
|---|---|
| Agent definitions scattered across Python/TypeScript files | Declarative YAML resources — versioned, portable, shareable |
| Credentials hardcoded alongside instructions | Environments and AgentInstances separate secrets from blueprints |
| No versioning — prompt changes have no audit trail | Every spec change creates a new version with full provenance |
| No reuse — every team reinvents the same patterns | Marketplace: publish and reference agents, skills, and MCP servers by `org/slug` |
| No composition standard for multi-agent systems | Sub-agents with inherited tool restrictions declared inline |
| LLM calls are fire-and-forget black boxes | Full lifecycle control: pause, resume, cancel, recover, approve |
| No approval gates for destructive tool calls | Human-in-the-loop approvals configurable per tool |
| Local dev and production require different code | Same YAML, same CLI — different AgentInstance |
| Automation scripts die on server restart | Durable Temporal execution — resumes from last checkpoint |
| No observability into running agents or pipelines | Real-time streaming, token tracking, task-level progress |

---

## Getting Started

```bash
# 1. Start the local Stigmer server (bootstraps automatically)
stigmer server start

# 2. Create an agent
cat > my-agent.yaml << 'EOF'
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: my-assistant
  org: default
spec:
  description: "A helpful assistant"
  instructions: |
    You are a helpful assistant. Answer questions clearly and concisely.
EOF

stigmer apply -f my-agent.yaml

# 3. Run it
stigmer run my-assistant "What is Stigmer?"

# 4. See your agents
stigmer list agents

# 5. Check server status
stigmer server status
```

---

## Further Reading

### Core Concepts
- [What is an Agent?](what-is-agent.md) — The foundational resource: instructions, tools, knowledge, sub-agents
- [What is a Workflow?](what-is-workflow.md) — Deterministic automation pipelines with 13 task types
- [What is an MCP Server?](what-is-mcp-server.md) — Portable, versioned tool integration definitions
- [What is a Skill?](what-is-skill.md) — Content-addressed domain knowledge packages

### Runtime
- [What is an Agent Execution?](what-is-agent-execution.md) — Lifecycle control, HITL approvals, checkpoint recovery
- [What is a Session?](what-is-session.md) — Persistent conversation context and workspace
- [What is a Workspace?](what-is-workspace.md) — Git repos and local paths as agent working directories
- [What is Agent Runner?](what-is-agent-runner.md) — The Python execution engine
- [What is Workflow Runner?](what-is-workflow-runner.md) — The Go execution engine

### Environment and Credentials
- [What is an Agent Instance?](what-is-agent-instance.md) — Binding blueprints to credentials
- [What is an Environment?](what-is-environment.md) — Encrypted key-value stores for secrets and config
- [What is an Execution Context?](what-is-execution-context.md) — Ephemeral runtime secret bundles

### Platform
- [What is an Organization?](what-is-organization.md) — Root namespace and multi-tenancy
- [What is a Project?](what-is-project.md) — Managed resource groupings with orphan pruning
- [What is Stigmer Server?](what-is-stigmer-server.md) — The API backbone
- [What is Seedpack?](what-is-seedpack.md) — Built-in system agents that bootstrap every install

### Identity and Access
- [What is an Identity Account?](what-is-identity-account.md) — The canonical principal type
- [What is an IAM Policy?](what-is-iam-policy.md) — Declarative access grants
- [What is an Identity Provider?](what-is-identity-provider.md) — Federated authentication for external platforms
- [What is an API Key?](what-is-api-key.md) — Managed programmatic credentials
