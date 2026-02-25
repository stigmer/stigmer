# Skill Integration

How Agents reference and use Skills — reusable packages of agent knowledge.

## What Are Skills?

Skills are reusable packages of agent knowledge. A skill contains a `SKILL.md` file (with YAML frontmatter and Markdown instructions) that gets injected into the agent's context at runtime, providing specialized workflows, domain expertise, and tool guidance.

Skills are versioned resources (`kind: skill`, enum value 43). Each version is immutably identified by a content hash. Tags (e.g., `stable`, `latest`) provide mutable pointers to specific versions.

## How Agents Reference Skills

Agents declare skill references via `spec.skill_refs`. Each entry is an `ApiResourceReference` pointing to a Skill resource.

```yaml
spec:
  skill_refs:
    - org: local
      kind: skill
      slug: code-review-best-practices
    - org: local
      kind: skill
      slug: api-design-guide
      version: stable
```

## Skill Reference Fields

Each entry in `skill_refs` is an `ApiResourceReference`. See [resource-references.md](resource-references.md) for the full format specification.

| Field | Required | Description |
|---|---|---|
| `org` | Yes | Organization owning the skill. |
| `kind` | Yes | Must be `skill`. |
| `slug` | Yes | Skill slug identifier. |
| `version` | No | Tag or content hash. Empty = latest version. See [Version Pinning](resource-references.md#version-pinning-skills-only). |

## How Skills Are Injected at Runtime

Skills are **read, not executed**. They provide knowledge to the agent as additional context, not as runnable code. The injection mechanism works in two phases:

### Phase 1: Registration

When the agent starts, the backend resolves each `skill_ref` to its `SKILL.md` content. Every referenced skill's **name** and **description** (from the YAML frontmatter in `SKILL.md`) are always loaded into the agent's context. This gives the agent awareness of all skills it has available.

### Phase 2: Activation

The full `SKILL.md` body is **not** loaded all at once. Instead, the agent's runtime uses the skill descriptions to determine relevance:

- The agent receives a user request
- The runtime matches the request against the registered skill descriptions (name + description from frontmatter)
- When a skill's description is relevant to the current request, the full `SKILL.md` Markdown body is loaded into the agent's context

This lazy-loading approach keeps the context window manageable when an agent has many skills, loading full content only when relevant.

### Phase 3: Bundled Resources

Skills can include bundled resources in subdirectories (`references/`, `scripts/`, `assets/`). These are **not** loaded automatically — the agent loads them on demand when the skill's instructions reference them. For example, a skill might say "See `references/examples.md` for detailed examples" and the agent will fetch that file when needed.

### Skill Package Structure

```
my-skill/
├── SKILL.md              # Required — frontmatter + instructions
└── references/           # Optional — additional knowledge
    ├── examples.md
    └── best-practices.md
└── scripts/              # Optional — executable scripts
    └── setup.sh
└── assets/               # Optional — static files
    └── template.yaml
```

## Version Resolution

Skills are the only versioned resource type in the platform. Version resolution follows this precedence:

| `version` Value | Resolution |
|---|---|
| Empty / omitted | Latest version (most recently published) |
| `latest` | Same as empty — latest version |
| Tag name (e.g., `stable`) | Resolves to the version tagged with this name. Tags are mutable — `stable` may point to different content over time. |
| 64-char hex hash | Immutable reference to an exact version by content hash. Always resolves to the same content. |

For production agents that need reproducible behavior, pin skills to a specific content hash. For agents that should always use the latest knowledge, omit the version field.

## Sub-Agent Skill Independence

Sub-agent `skill_refs` are **independent** of the parent agent's skills. A sub-agent can reference any skill, even if the parent does not reference it. This allows sub-agents to have specialized knowledge without bloating the parent's context. See [sub-agents.md](sub-agents.md) for details.
