# Agent Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` Agent resource.

## What Is an Agent?

An Agent is a Kubernetes-style API resource that defines the **template layer** of an AI agent. It declares the agent's identity, behavior, tool access, and knowledge — everything needed to describe _what_ an agent can do and _how_ it should behave.

Agents do not run on their own. They are instantiated, bound to a runtime environment, and then executed within a session.

## Agent Lifecycle

```
Agent ──► AgentInstance ──► Session ──► AgentExecution
```

| Resource | Analogy | Purpose |
|---|---|---|
| **Agent** | Docker image | Declares capabilities and configuration. Immutable template. |
| **AgentInstance** | Container config (docker-compose service) | Binds an Agent to an Environment — provides secrets, credentials, and runtime configuration. Every Agent has a default instance created automatically. |
| **Session** | Container runtime | Groups related executions into a conversational context. Maintains state across multiple runs. |
| **AgentExecution** | Container run (`docker run`) | A single run of an agent instance within a session. Produces messages, tool calls, and results. |

The Agent resource is the only one users author directly in YAML. AgentInstances, Sessions, and AgentExecutions are created via the API or CLI at runtime.

## Documentation Index

| Document | Description |
|---|---|
| [agent-resource-guide.md](agent-resource-guide.md) | Core YAML schema reference — metadata, spec fields, env spec, status, CLI commands |
| [resource-references.md](resource-references.md) | `ApiResourceReference` format — how to reference MCP servers, skills, and other resources |
| [mcp-server-integration.md](mcp-server-integration.md) | MCP server usage, tool selection, approval overrides, and runtime resolution |
| [skill-integration.md](skill-integration.md) | Skill references, versioning, and how skills are injected at runtime |
| [sub-agents.md](sub-agents.md) | Sub-agent delegation, MCP access grants, and the permission model |
| [examples.md](examples.md) | Complete YAML examples from minimal to full-featured |
| [validation-checklist.md](validation-checklist.md) | Pre-apply checklist and common pitfalls |

## Querying Available Resources

MCP servers and skills are first-class platform resources that can be discovered and inspected at runtime.

The **Stigmer MCP server** (`slug: stigmer-mcp-server`) exposes tools for querying the platform:

| Tool | Purpose |
|---|---|
| `search` | Full-text search across agents, skills, MCP servers, workflows |
| `get_agent` | Get a specific agent by org and slug |
| `get_mcp_server` | Get a specific MCP server by org and slug |
| `get_skill` | Get a specific skill by org and slug |
| `get_workflow` | Get a specific workflow by org and slug |

When creating an agent, **always query available resources first** — use `search` or the `get_*` tools to find real MCP servers with their actual tool names and skills that match the agent's domain. Never guess resource references; if a needed MCP server or skill doesn't exist, surface this to the user rather than inventing a reference.
