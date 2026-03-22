# What is a Skill?

## One-Sentence Positioning

**A Skill is a portable, versioned, content-addressed package of domain knowledge—the same way an npm package is a portable, versioned unit of reusable code.**

---

## Executive Summary

A Skill is a Stigmer API resource that packages domain knowledge for agents. It is a directory containing a `SKILL.md` file—a Markdown document written as direct instructions to an AI agent—that the platform stores, versions, and injects into agent context at runtime.

Skills solve a specific problem: agents need specialized knowledge (workflows, style guides, runbooks, domain expertise) but that knowledge should not be hardcoded into a single agent's instructions. Skills let you package that knowledge once, version it independently, and share it across every agent that needs it.

When an agent references a skill, the runtime loads the `SKILL.md` content into the agent's context window before each execution. The agent reads those instructions the same way it reads its own system prompt—with the same authority and scope.

Skills are versioned using content-addressed hashing. Every unique push produces a unique immutable version hash. Mutable tags (`latest`, `stable`) sit on top as named pointers. An agent can float on `latest`, pin to a named tag, or lock to a specific hash for fully reproducible behavior.

---

## The Problem Skills Solve

### Knowledge Gets Scattered and Duplicated

Most teams embed domain knowledge directly into agent instructions. Every agent that needs to know your company's deployment procedures gets its own copy of those procedures in its system prompt.

**Typical approach — knowledge embedded in the agent:**

```yaml
spec:
  instructions: |
    You are a deployment assistant. Follow these rules:
    1. Never deploy to production on Fridays
    2. Always run the smoke test suite before promoting
    3. Require two approvals for database migrations
    4. Post a Slack message to #deployments before and after
    # ... 200 more lines of deployment procedures ...
```

This works until it doesn't.

**What goes wrong:**

- The same procedures are copied into the instructions of five different agents. When the procedure changes, someone updates two of them and forgets the other three.
- There is no version history for the procedure. You cannot answer "what rules was this agent following when it ran that deployment last quarter?"
- A new team member wants to build an agent that follows the same procedures. They copy the instructions from an existing agent—which may already be out of date.
- Some agents need the full procedures; others only need a subset. But the knowledge is embedded in agent instructions, not structured for selective reuse.
- Updating a procedure requires touching every agent YAML that embeds it. There is no single source of truth.

### The Hidden Cost

Over time, this creates a fragmentation problem:

- **No canonical source**: Which agent's instructions have the latest version of the style guide?
- **No audit trail**: You cannot answer "what knowledge was this agent operating with on this date?"
- **No sharing standard**: There is no way to publish a knowledge package the way you publish a library.
- **No reuse without copy**: Every team reinvents the same domain knowledge from scratch.
- **Context bloat**: Long instructions with embedded knowledge grow unbounded, consuming context space even when the knowledge is not relevant to the current request.

---

## The Stigmer Skill

### One Package. Any Agent. Any Version.

Stigmer treats domain knowledge the way npm treats code: as a versioned, shareable artifact that any consumer can reference by name.

**The same skill can be referenced from any agent:**

```yaml
# Any agent in your org—or any agent from any org that has access
spec:
  skill_refs:
    - org: acme-corp
      kind: skill
      slug: deployment-procedures
      version: stable
```

**Update the skill once; every agent picks it up at its next version resolution:**

```bash
# Edit SKILL.md with the updated procedures
stigmer push skill ./skills/deployment-procedures --tag stable
# → All agents referencing version: stable now use the updated content
```

### What the SKILL.md Looks Like

```markdown
---
name: deployment-procedures
description: "Acme Corp deployment rules, approval requirements, and post-deploy checklist"
version: "2.1.0"
---

# Deployment Procedures

## When to Use This Skill
Use this skill whenever you are preparing, executing, or verifying a deployment
to any Acme Corp environment.

## Environment Rules
- **Development**: Deploy freely. No approval required.
- **Staging**: Automated smoke tests must pass before promotion.
- **Production**: Requires two human approvals. Never deploy on Fridays.

## Pre-Deploy Checklist
1. Confirm the target environment in the deployment manifest
2. Run the smoke test suite: `./scripts/smoke-test.sh <env>`
3. Verify that no database migrations are pending unless approved
4. Post a deployment notice to #deployments in Slack

## Post-Deploy Checklist
1. Confirm that health checks pass within five minutes
2. Monitor error rate for 15 minutes post-deploy
3. Update the deployment log with the outcome
4. Close the deployment ticket if all checks passed

## Database Migrations
Database migrations require a separate approval from the platform engineering team.
Open a migration approval request at least 24 hours before the deploy window.
```

Push it. Reference it from any agent. Version it independently.

---

## How Skills Are Published

Skills are not authored as YAML files. They are pushed as directory artifacts.

```bash
# Push from the current directory (tags "latest" by default)
stigmer push skill

# Push from a specific directory
stigmer push skill ./skills/deployment-procedures

# Push with an explicit version tag
stigmer push skill ./skills/deployment-procedures --tag stable

# Push from a remote git repository
stigmer push skill \
  --git-url https://github.com/acme-corp/skills.git \
  --git-ref v2.1.0 \
  --subdir skills/deployment-procedures \
  --tag stable

# Preview what would be packaged without pushing
stigmer push skill --dry-run --verbose
```

The CLI packages the directory into a ZIP artifact, computes a SHA-256 hash, extracts metadata from the `SKILL.md` frontmatter, and stores the result on the platform.

### Skill vs. Agent: A Key Distinction

| | Agent | Skill |
|---|---|---|
| **Authored as** | YAML file | Directory with `SKILL.md` |
| **Published with** | `stigmer apply agent.yaml` | `stigmer push skill [path]` |
| **Versioned by** | Spec change tracking | SHA-256 content hash |
| **Updated by** | Edit YAML, re-apply | Edit files, re-push |
| **Referenced in** | Runs directly | `spec.skill_refs` in Agent YAML |

An agent is declared. A skill is pushed.

---

## Lifecycle: From Authoring to Execution

```
Author SKILL.md  ──►  stigmer push skill  ──►  Platform stores artifact
        │                     │                       │
        │              CLI packages                Calculates SHA-256
        │              directory as ZIP            hash (version ID)
        │
        ▼
Agent references skill  ──►  Runtime resolves version  ──►  SKILL.md injected
  via spec.skill_refs          (tag → hash → content)        into agent context
```

**States a skill passes through:**

| State | Meaning |
|---|---|
| `SKILL_STATE_UPLOADING` | The CLI is uploading the artifact to storage. Not yet usable. |
| `SKILL_STATE_READY` | The artifact is stored. The skill is fully usable by agents. |
| `SKILL_STATE_FAILED` | Upload or processing failed. Re-push to recover. |

---

## The Three Parts of a Skill

### 1. The `SKILL.md` File (Required)

`SKILL.md` is the entry point of every skill. It has two components:

**Frontmatter** — machine-readable metadata that drives search, discovery, and runtime activation:

```markdown
---
name: deployment-procedures
description: "Acme Corp deployment rules, approval requirements, and post-deploy checklist"
version: "2.1.0"
---
```

| Field | Required | Purpose |
|---|---|---|
| `name` | Yes | Canonical identifier. Kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`). Becomes the skill's slug. |
| `description` | Strongly recommended | Drives runtime activation decisions and marketplace display. Answer: *when should an agent use this?* Keep under 100 tokens. |
| `version` | No | Informational label. Not used for platform versioning—the SHA-256 hash is authoritative. |

**Body** — the Markdown instructions injected into the agent's context. Write it as direct instructions *to* the agent, not documentation about the skill:

```markdown
# Good — imperative, agent-directed
## When to Use This Skill
Use this skill whenever the user asks you to evaluate a mathematical expression.

## How to Format Results
Always show your work step by step. Use LaTeX notation for complex expressions.
```

```markdown
# Poor — describes the skill from the outside
## Overview
This skill provides mathematical calculation capabilities built by the platform team in 2024.
```

**Body length guidance:**

| Length | Guidance |
|---|---|
| Under 500 words | Ideal for most skills. Comfortable in context. |
| 500–2000 words | Acceptable for complex domains. Consider splitting into sub-skills. |
| Over 2000 words | High risk of context pressure. Extract sections to `references/`. |

### 2. The `references/` Directory (Optional)

Use `references/` for supplementary knowledge that the agent loads on demand. The agent does not auto-load bundled files—it loads them when the `SKILL.md` body explicitly directs it to.

This is the primary mechanism for keeping the skill's base context size small while still making detailed information available:

```markdown
## Security Review
For the full security checklist, see `references/security-checklist.md`.
Apply every item in that checklist to the code under review.
```

Good candidates for `references/`:
- Detailed examples the agent consults case-by-case
- Complete rule sets or style guides referenced by name in the body
- Domain reference material (API documentation excerpts, glossaries)

### 3. The `scripts/` and `assets/` Directories (Optional)

Use `scripts/` for executable files the agent runs as tools. Use `assets/` for static files the agent uses as templates, schemas, or configuration. The agent-runner extracts skill artifacts into `/bin/skills/<version_hash>/` in the execution sandbox.

**Full package structure:**

```
my-skill/
├── SKILL.md              # Required — frontmatter + instructions
├── .stigmerignore        # Optional — additional exclude patterns
├── references/           # Optional — supplementary knowledge (on demand)
│   ├── examples.md
│   ├── style-guide.md
│   └── api-reference.md
├── scripts/              # Optional — executable files
│   ├── setup.sh
│   └── validate.py
└── assets/               # Optional — static files
    ├── template.yaml
    └── schema.json
```

---

## Versioning

### Two-Layer Model

Every skill version has two identifiers:

| Identifier | Type | Example | Characteristics |
|---|---|---|---|
| **Content hash** | SHA-256 of the artifact ZIP | `a1b2c3d4e5f6...` (64 hex chars) | Immutable. Permanent. Computed automatically. |
| **Tag** | User-provided label | `stable`, `v1.0.0`, `latest` | Mutable. Can be moved to a different hash at any time. |

A tag is a named pointer to a hash. The hash is the ground truth.

```
Tags (mutable pointers)          Hashes (immutable versions)
─────────────────────            ─────────────────────────────
latest  ─────────────────────►  hash: a1b2c3...  (pushed today)
stable  ─────────────────────►  hash: 9f8e7d...  (pushed last week)
v1.0.0  ─────────────────────►  hash: 4c3b2a...  (original release)
```

### Pinning Strategy

| Reference | Reproducible? | Auto-updates? | Use For |
|---|---|---|---|
| `version: ""` (latest) | No | Yes, on every push | Development, always-current knowledge |
| `version: stable` | No | Yes, when tag is moved | Governed releases with coordinated updates |
| `version: a1b2c3...` (hash) | **Yes** | Never | Production, audit, reproducible pipelines |

**In Agent YAML:**

```yaml
# Float to latest (development)
skill_refs:
  - org: acme-corp
    kind: skill
    slug: deployment-procedures

# Pin to named tag (governed releases)
skill_refs:
  - org: acme-corp
    kind: skill
    slug: deployment-procedures
    version: stable

# Pin to immutable hash (production / audit)
skill_refs:
  - org: acme-corp
    kind: skill
    slug: deployment-procedures
    version: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
```

### Archived Versions

When a push updates a skill, the previous version is archived—not deleted. Archived versions are not visible in `stigmer list skills` output but remain accessible via their hash. Agents that were configured with a specific hash always have access to their artifact.

---

## Visibility and the Marketplace

Skills support two visibility levels:

```yaml
# Private — only your org can see or use it (default)
metadata:
  name: internal-runbook
  org: acme-corp
  visibility: visibility_private

# Public — anyone can discover and reference it
metadata:
  name: json-formatter
  org: acme-corp
  visibility: visibility_public
```

Public skills appear in the Stigmer marketplace. Any agent from any org can reference a public skill by `org/slug`. This is how the community shares reusable knowledge packages—the same way npm packages are shared and consumed.

---

## How It Compares

| Without Stigmer Skills | With Stigmer Skills |
|---|---|
| Domain knowledge embedded in agent instructions | Packaged in a versioned `SKILL.md`, independent of any agent |
| Same procedures copied across five agents | One skill referenced from five agents |
| No history of what rules an agent followed | Every version preserved by content hash; fully auditable |
| Updating a procedure requires touching every agent | Update the skill once; all referencing agents pick it up |
| No way to share knowledge across teams | Public skills in the marketplace; reference by `org/slug` |
| Context bloat from long embedded instructions | Skill body loaded only when relevant; references loaded on demand |
| No rollback when a knowledge update causes issues | Re-push the previous content; old hash is always available |

---

## Getting Started

```bash
# 1. Create the skill directory and SKILL.md
mkdir -p skills/my-skill
cat > skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: "A brief description of what this skill does and when to use it"
---

# My Skill

## When to Use This Skill
Describe when the agent should apply this skill's guidance.

## Core Instructions
Write the main behavioral guidance here.
EOF

# 2. Validate the artifact before pushing
stigmer push skill ./skills/my-skill --dry-run

# 3. Push the skill (tags "latest" by default)
stigmer push skill ./skills/my-skill

# 4. Reference it from an agent
cat > my-agent.yaml << 'EOF'
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: my-assistant
  org: default
spec:
  description: "A helpful assistant"
  instructions: |
    You are a helpful assistant.
  skill_refs:
    - kind: skill
      slug: my-skill
EOF
stigmer apply -f my-agent.yaml

# 5. See all your skills
stigmer list skills

# 6. Inspect a skill
stigmer get skill my-skill --output yaml
```

---

## Further Reading

- [Skill SKILL.md Format](../../apis/ai/stigmer/agentic/skill/docs/skill-md-format.md) — Frontmatter schema, body guidelines, package structure
- [Publishing Skills](../../apis/ai/stigmer/agentic/skill/docs/publishing-skills.md) — CLI push, remote git push, SDK handover
- [Versioning](../../apis/ai/stigmer/agentic/skill/docs/versioning.md) — Content hashes, tags, and version resolution
- [Examples](../../apis/ai/stigmer/agentic/skill/docs/examples.md) — Complete examples from minimal to full-featured
- [Validation Checklist](../../apis/ai/stigmer/agentic/skill/docs/validation-checklist.md) — Pre-push checklist and common pitfalls
- [Agent: Skill Integration](../../apis/ai/stigmer/agentic/agent/docs/skill-integration.md) — How to reference skills from agent YAML
