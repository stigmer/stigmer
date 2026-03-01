# What is an Agent?

## One-Sentence Positioning

**An Agent is a portable, versioned, declarative definition of an AI worker—the same way a Docker image is a portable, versioned definition of a container.**

---

## Executive Summary

An Agent is Stigmer's core API resource. It is a YAML document that declares everything an AI worker needs: what it should do and how it should behave (instructions), what external tools it can access (MCP servers), what domain knowledge it carries (skills), and which specialized sub-agents it can delegate to.

The Agent is the *template*—the blueprint. It does not run on its own. When you want to actually execute it, Stigmer creates an AgentInstance (binding credentials and environment to the template), a Session (the conversation context), and an AgentExecution (a single run). Separating the blueprint from the runtime means you author your agent once and run it anywhere: locally on SQLite, or in Stigmer Cloud with full team management and audit trails.

Agents are versioned, shareable, and composable. A team can publish an agent to the marketplace so anyone can use it with a single slug reference. A parent agent can delegate to focused sub-agents, each with a restricted slice of the parent's tool access. Every change to an agent's spec is tracked with an audit trail—who changed what, and when.

---

## The Problem Agents Solve

### AI Agents Are Built the Wrong Way

Most teams build AI agents by hardcoding everything into application code:

**Typical Python approach:**

```python
client = anthropic.Anthropic()
response = client.messages.create(
    model="claude-opus-4-5",
    system="You are a code review assistant...",
    tools=[github_tool, slack_tool],
    messages=[{"role": "user", "content": user_input}],
)
```

This works for a proof of concept. It breaks down at team scale.

**What goes wrong:**

- The system prompt lives in a Python file. There is no history of how it evolved, no way to roll back to last week's version, no diff when a teammate changes it.
- The tool wiring is hardcoded. Adding a new MCP server means touching application code, not configuration.
- Sharing the agent with another team means copying code. If the original team improves it, the copy never gets the update.
- Building a multi-agent system means manually writing delegation logic—the orchestration code is the same every time, but you write it from scratch every time.
- The agent definition is inseparable from the application that runs it. You cannot "deploy" the agent independently of the whole service.

### The Hidden Cost of This Approach

This creates compounding problems over time:

- **No versioning**: System prompt changes have no audit trail. You cannot answer "what did the agent do six months ago?"
- **No reuse**: Every team reinvents the same patterns. There is no library of agents the way there is a library of Docker images.
- **No composition standard**: Multi-agent architectures require bespoke orchestration every time.
- **No portability**: An agent built for local development cannot be promoted to production without changing application code.
- **No governance**: No approval policy when an agent executes a destructive tool. No record of which user triggered which execution.

---

## The Stigmer Agent

### One Structure. Any Backend. Any Scale.

Stigmer gives AI agents the same treatment Kubernetes gave to workloads: a declarative API resource with a standard structure, versioning built in, and runtime decoupled from definition.

**The same agent YAML works everywhere:**

```bash
# Local development — SQLite, no server required
stigmer apply -f agent.yaml
stigmer run my-agent "Review this PR"

# Production — Stigmer Cloud, full audit trail
stigmer apply -f agent.yaml   # same command, same file
stigmer run my-agent "Review this PR"
```

### What the YAML Looks Like

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  org: acme-corp
  visibility: visibility_public
  tags:
    - code-review
    - security
spec:
  description: "Reviews code for quality, security, and best practices"
  instructions: |
    You are a code review assistant. For every review:
    1. Check for security vulnerabilities (injection, auth issues, secrets in code)
    2. Evaluate code quality and adherence to style guides
    3. Identify performance bottlenecks
    4. Suggest specific, actionable improvements

  mcp_server_usages:
    - mcp_server_ref:
        org: acme-corp
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_review_comment

  skill_refs:
    - org: acme-corp
      kind: skill
      slug: company-style-guide
    - org: acme-corp
      kind: skill
      slug: security-review-checklist
      version: stable

  sub_agents:
    - name: security-scanner
      description: "Focuses exclusively on security vulnerabilities"
      instructions: |
        You scan code for security vulnerabilities. Focus only on
        OWASP top 10 issues, secrets in code, and authentication flaws.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file
```

Apply it. Run it. Version it. Share it.

---

## Architecture: The Four Layers

An agent in Stigmer is not a single object. It is a stack of four resources, each with a distinct responsibility.

```
Agent ──► AgentInstance ──► Session ──► AgentExecution
```

| Layer | Analogy | What It Does |
|---|---|---|
| **Agent** | Docker image | Declares capabilities and configuration. Immutable template. You author this in YAML. |
| **AgentInstance** | Docker Compose service | Binds the Agent to an environment—provides secrets, credentials, and runtime values. Every Agent gets a default instance automatically. |
| **Session** | Terminal session | Groups related executions into a conversational context. Maintains message history across multiple runs. |
| **AgentExecution** | `docker run` | A single invocation of an agent instance within a session. Produces messages, tool calls, and results. |

**Why this separation matters:**

You author the Agent once. Then you can create multiple AgentInstances—one for development (pointing at a test GitHub org), one for production (pointing at the real org), one for a specific customer (with their API key). Same blueprint, different runtime environments.

You never touch the Agent YAML to change environment-specific values. That is what AgentInstance is for.

---

## The Four Building Blocks of an Agent

### 1. Instructions

The system prompt—the core of the agent's behavior and personality. Instructions define what the agent does, how it responds, and what constraints it operates under.

```yaml
spec:
  instructions: |
    You are a deployment assistant for Acme Corp.
    You help teams deploy applications safely.

    Rules:
    - Always verify the target environment before deploying
    - Require confirmation for production deployments
    - Log all deployment events to Slack
```

Instructions are versioned alongside the rest of the spec. When you change the instructions, the agent version increments and the previous version is preserved.

### 2. MCP Servers (Tools)

MCP servers give agents the ability to take action in external systems—GitHub, Slack, databases, Kubernetes clusters, internal APIs. Each MCP server exposes a set of named tools that the agent can call.

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - create_pr
        - get_file
      tool_approval_overrides:
        - tool_name: create_pr
          requires_approval: true
          message: "Create PR: {{args.title}}"
```

The `enabled_tools` list defines the maximum tool set for this agent. Sub-agents can only use a subset—they cannot expand their access beyond what the parent grants. The `tool_approval_overrides` field adds human-in-the-loop checkpoints for specific tools.

### 3. Skills (Knowledge)

Skills are reusable packages of domain knowledge. A skill contains a `SKILL.md` document—guidelines, workflows, reference material—that gets injected into the agent's context at runtime.

```yaml
spec:
  skill_refs:
    - org: acme-corp
      kind: skill
      slug: company-deployment-procedures
    - org: acme-corp
      kind: skill
      slug: kubernetes-runbook
      version: stable
```

Skills decouple knowledge from agent definition. Your entire engineering team can share the same `company-style-guide` skill, and when the style guide is updated, every agent referencing it picks up the change at its next pinned version.

### 4. Sub-Agents (Delegation)

Sub-agents let a parent agent delegate specialized tasks to focused workers. Each sub-agent has its own instructions and a restricted view of the parent's MCP server access—they can only use tools the parent explicitly grants.

```yaml
spec:
  sub_agents:
    - name: researcher
      description: "Searches and summarizes technical documentation"
      instructions: |
        You research technical topics. Search documentation,
        read relevant pages, and produce concise summaries.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file

    - name: writer
      description: "Writes and formats documentation"
      instructions: |
        You write clear technical documentation based on
        research provided to you. Follow company style guides.
```

The parent decides when to delegate; the sub-agents handle the specialized work. This keeps each sub-agent focused, auditable, and easy to reason about.

---

## How Agents Are Versioned and Shared

### Versioning

Every time you apply an agent with a changed spec, Stigmer creates a new version. The version record contains:

- The full spec at that point in time
- Who made the change and when
- A reference to the previous version

This means you can always answer: "What were this agent's instructions when it ran that deployment six months ago?"

### Visibility and the Marketplace

Agents support two visibility levels:

```yaml
# Private — only your org can see or use it
metadata:
  name: internal-deployment-bot
  org: acme-corp
  visibility: visibility_private

# Public — anyone can discover and use it
metadata:
  name: web-search-assistant
  org: acme-corp
  visibility: visibility_public
```

Public agents appear in the Stigmer marketplace. Anyone can reference a public agent by its org and slug. This is how the community shares reusable agents—the same way Docker Hub works for container images.

---

## How It Compares

| Without Stigmer Agents | With Stigmer Agents |
|---|---|
| System prompts scattered across Python/TypeScript files | Single versioned YAML, tracked in git |
| Tool integrations hardcoded into application code | MCP server references—swap or update without touching agent logic |
| No rollback when a prompt change breaks behavior | Every version preserved; rollback is a `stigmer apply` |
| Sharing an agent means copying code | Reference a public agent by `org/slug`; improvements propagate |
| Multi-agent delegation written from scratch each time | Sub-agents declared inline; delegation routing is built in |
| No audit trail of who ran what, when | Every execution linked to an AgentInstance, Session, and Execution record |
| Local dev agents cannot promote to production cleanly | Same YAML, different backend—`local` vs. cloud org |

---

## Getting Started

```bash
# 1. Create an agent YAML
cat > my-agent.yaml << 'EOF'
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: my-assistant
  org: local
spec:
  description: "A helpful assistant"
  instructions: |
    You are a helpful assistant. Answer questions clearly and concisely.
EOF

# 2. Apply it
stigmer apply -f my-agent.yaml

# 3. Run it
stigmer run my-assistant "What is an agent in Stigmer?"

# 4. See all your agents
stigmer agent list
```

---

## Further Reading

- [Agent YAML Schema Reference](../../apis/ai/stigmer/agentic/agent/docs/agent-resource-guide.md) — Complete field documentation
- [MCP Server Integration](../../apis/ai/stigmer/agentic/agent/docs/mcp-server-integration.md) — Tool access and approval policies
- [Skill Integration](../../apis/ai/stigmer/agentic/agent/docs/skill-integration.md) — Injecting reusable knowledge
- [Sub-Agents](../../apis/ai/stigmer/agentic/agent/docs/sub-agents.md) — Delegation and permission model
- [Examples](../../apis/ai/stigmer/agentic/agent/docs/examples.md) — Complete YAML examples from minimal to full-featured
- [Agent Execution Lifecycle](../architecture/agent-execution-lifecycle.md) — Phases, pause/resume/cancel, checkpoint preservation
