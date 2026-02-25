# Skill Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` Skill resource.

## What Is a Skill?

A Skill is a versioned, reusable unit of agent capability. It is a content artifact — a directory containing a `SKILL.md` file and optional supporting files — that the platform stores, versions, and injects into agent context at runtime.

Skills provide agents with specialized knowledge: domain expertise, workflows, best practices, and tool usage patterns. When an agent references a skill, the runtime loads the `SKILL.md` content into the agent's context, giving it the knowledge defined in that file.

## Skill vs. Agent: A Critical Distinction

Skills and Agents are authored and published differently. This is the most common source of confusion for users coming to Skills after learning Agents.

| | Agent | Skill |
|---|---|---|
| **Authored as** | YAML file | Directory with `SKILL.md` |
| **Published with** | `stigmer apply agent.yaml` | `stigmer push skill [path]` |
| **Versioned by** | Not versioned | SHA-256 content hash |
| **Updated by** | Edit YAML, re-apply | Edit files, re-push |
| **Referenced in** | Not referenced (runs directly) | `spec.skill_refs` in Agent YAML |

An agent is declared. A skill is pushed.

## Skill Lifecycle

```
Author SKILL.md  ──►  stigmer push skill  ──►  Platform stores artifact
        │                     │                       │
        │              CLI creates ZIP          Calculates SHA-256
        │              from directory           hash (version ID)
        │
        ▼
Agent references skill  ──►  Runtime resolves version  ──►  SKILL.md injected
  via spec.skill_refs          (tag → hash → content)        into agent context
```

The platform's version model is content-addressed: every unique artifact produces a unique immutable hash. Tags (like `latest`, `stable`) are mutable pointers layered on top of this immutable foundation.

## Two Audiences

This documentation serves two distinct audiences:

**Skill Authors** — engineers building reusable capability packages:
- [skill-md-format.md](skill-md-format.md) — start here
- [publishing-skills.md](publishing-skills.md)
- [versioning.md](versioning.md)
- [examples.md](examples.md)
- [validation-checklist.md](validation-checklist.md)

**Agent Authors** — engineers referencing skills from agents:
- [skill-resource-guide.md](skill-resource-guide.md) — understand what the platform stores
- [versioning.md](versioning.md) — understand version pinning
- [Agent docs: skill-integration.md](../agent/docs/skill-integration.md) — how to reference skills in Agent YAML

## Documentation Index

| Document | Description |
|---|---|
| [skill-resource-guide.md](skill-resource-guide.md) | API schema reference — metadata, spec, status, state lifecycle, CLI commands |
| [skill-md-format.md](skill-md-format.md) | `SKILL.md` authoring guide — frontmatter schema, body guidelines, package structure |
| [publishing-skills.md](publishing-skills.md) | Push workflow — CLI local push, remote git push, SDK handover, git provenance, tags |
| [versioning.md](versioning.md) | Versioning model — content hashes, mutable tags, version resolution, pinning strategy |
| [examples.md](examples.md) | Complete examples from minimal skill to full-featured multi-file packages |
| [validation-checklist.md](validation-checklist.md) | Pre-push checklist and common pitfalls |

## Querying Skills

Use the Stigmer MCP server (`slug: stigmer-mcp-server`) to discover existing skills:

| Tool | Purpose |
|---|---|
| `search` | Full-text search across skills, agents, MCP servers, workflows |
| `get_skill` | Get a specific skill by org and slug |

When authoring an agent that references skills, always query first. Never guess a skill slug — a reference to a nonexistent skill fails silently at configuration time and loudly at runtime.
