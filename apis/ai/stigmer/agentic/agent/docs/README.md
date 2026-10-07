# Agent Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` Agent resource.

## What Is an Agent?

An Agent is a Kubernetes-style API resource that defines the **template layer** of an AI agent. It declares the agent's identity, behavior, tool access, and knowledge — everything needed to describe _what_ an agent can do and _how_ it should behave.

Agents do not run on their own. A session names an agent directly, and each run in it runs that agent at the version the session pinned.

## Agent Lifecycle

```
Agent ──► Session ──► Run
```

| Resource | Analogy | Purpose |
|---|---|---|
| **Agent** | Docker image | Declares capabilities and configuration. Every change to the definition is kept as a version. |
| **Session** | Container runtime | Names the agent (`agent_ref`) and pins the version it resolved. Groups related runs into a conversational context. Maintains state across multiple runs. |
| **Run** | Container run (`docker run`) | A single run of the session's agent, at the pinned version. Produces messages, tool calls, and results. |

The Agent resource is the only one users author directly in YAML. Sessions and Runs are created via the API or CLI at runtime. The agent declares the keys it needs itself (`env`); each MCP server declares its own. Values come from Credentials when a run starts: the run's `runtime_env`, the credential assignments on the schedule, share link, channel or PlatformClient that started a run with no person, or the Credential of the person who sent the message that serves the agent or MCP server (or the organization's, when that person may use it).

## Documentation Index

| Document | Description |
|---|---|
| [agent-resource-guide.md](agent-resource-guide.md) | Core YAML schema reference — metadata, spec fields, env spec, run defaults (`run_config`, `harness`), status, CLI commands |
| [resource-references.md](resource-references.md) | `ApiResourceReference` format — how to reference MCP servers, skills, and other resources |
| [mcp-server-integration.md](mcp-server-integration.md) | MCP server usage, the `tools` and `disallowed_tools` lists, which tools ask for approval, and runtime resolution |
| [skill-integration.md](skill-integration.md) | Skill references, versioning, and how skills are injected at runtime |
| [sub-agents.md](sub-agents.md) | Sub-agent delegation, narrowing the parent's tools, and the permission model |
| [examples.md](examples.md) | Complete YAML examples from minimal to full-featured |
| [validation-checklist.md](validation-checklist.md) | Pre-apply checklist and common pitfalls |

## Querying Available Resources

MCP servers and skills are first-class platform resources that can be discovered and inspected at runtime.

The **Stigmer MCP server** (`slug: stigmer-mcp-server`) exposes tools for querying the platform:

| Tool | Purpose |
|---|---|
| `search` | Full-text search across agents, skills and MCP servers |
| `get_agent` | Get a specific agent by org and slug |
| `get_mcp_server` | Get a specific MCP server by org and slug |
| `get_skill` | Get a specific skill by org and slug |

When creating an agent, **always query available resources first** — use `search` or the `get_*` tools to find real MCP servers with their actual tool names and skills that match the agent's domain. Never guess resource references; if a needed MCP server or skill doesn't exist, surface this to the user rather than inventing a reference.
