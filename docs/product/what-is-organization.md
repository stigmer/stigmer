# What is an Organization?

## One-Sentence Positioning

**An Organization is the root namespace for all Stigmer resources—the same way a GitHub organization is the root namespace for all repositories.**

---

## Executive Summary

An Organization is Stigmer's top-level tenancy resource. It is the container that owns everything else: agents, workflows, MCP servers, skills, sessions, and executions. Every resource in Stigmer belongs to exactly one organization, referenced via `metadata.org`.

Organizations provide multi-tenancy and access isolation. Members are users who belong to an organization and have role-based permissions over its resources. Nothing crosses organization boundaries without an explicit reference—an agent in `acme-corp` cannot accidentally read or execute resources owned by `rival-corp`.

Organizations come in two modes: **self-managed** (created directly by users via the Stigmer UI, CLI, or API) and **platform-managed** (created programmatically by an external platform via an IdentityProvider). Mode is chosen at creation time and is immutable—it cannot be changed afterward.

---

## The Problem Organizations Solve

### Resources Without a Namespace Are Chaos

Most early-stage AI platforms have no formal notion of tenancy. Everything lives in a flat global namespace or under individual user accounts. This creates predictable problems as teams grow:

- **No isolation**: One team's agents and credentials are visible to everyone. There is no boundary.
- **No shared ownership**: Resources belong to a user, not a team. When the user leaves, the assets go with them.
- **No access control surface**: You cannot say "the security team owns this MCP server; only they can update it." The concept of team ownership doesn't exist.
- **No auditability at the org level**: You cannot ask "who in the engineering org changed this agent last week?" There is no org to scope the audit to.

### The Hidden Cost of Flat Namespaces

Without organizational structure, the cost compounds:

- **Credential sprawl**: API keys and secrets are owned by individuals, not teams. Rotation is a coordination nightmare.
- **Duplicated effort**: Every team builds its own version of the same agents because there is no shared namespace to discover and reuse what already exists.
- **Onboarding friction**: New team members have no clear place to find resources. Discovery is word-of-mouth.
- **No marketplace**: You cannot publish agents for other teams to use if there is no organization identity to publish from.

---

## The Stigmer Organization

### One Namespace. Every Resource.

An Organization is a first-class resource in Stigmer. It is declared in YAML, has a stable slug, and owns every other resource by reference. The organization slug appears in every resource's `metadata.org` field and in every cross-resource reference.

```yaml
# This agent belongs to acme-corp
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  org: acme-corp   # ← organization ownership
```

The organization slug is the single coordinate that scopes all resources. Query `acme-corp`'s agents, and you see exactly the agents that org has published—no more, no less.

### What the YAML Looks Like

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Acme Corp
  slug: acme-corp
  labels:
    industry: fintech
    tier: enterprise
spec:
  description: "Acme Corp AI agents and automation platform"
  logo_url: "https://acme.com/assets/logo.svg"
  management_mode: self_managed
```

Create it once. Reference it everywhere.

---

## Architecture: Organization as the Root

Organizations sit at the top of the Stigmer resource hierarchy. Every other resource is scoped under one.

```
Organization
├── Agents
│   └── AgentInstances
├── Workflows
│   └── WorkflowInstances
├── MCP Servers
├── Skills
├── Sessions
│   └── AgentExecutions
│   └── WorkflowExecutions
└── Members (IAM)
```

| Resource | Organization Field |
|---|---|
| Agent | `metadata.org` |
| Workflow | `metadata.org` |
| MCP Server | `metadata.org` |
| Skill | `metadata.org` |
| Session | owned by org of the triggering instance |
| Member | membership record links user ↔ org |

### Local Mode

When running Stigmer locally (SQLite, no cloud), the system bootstraps a built-in organization with slug `local`. All local resources default to `org: local`. You do not create it—it exists automatically.

```bash
# Local: org defaults to local
stigmer agent list          # lists agents in org: local
stigmer run my-agent "..."  # runs an agent in org: local
```

### Cloud Mode

In cloud mode, you create and manage real organizations. Resources must explicitly declare their organization, and the Authorization Service enforces membership for every write operation.

---

## Management Modes

### `self_managed` (Default)

The user creates the organization directly. Members are invited manually. The org owner has full control via the Stigmer UI, CLI, or API.

```yaml
spec:
  management_mode: self_managed
```

Use `self_managed` for organizations you operate directly—your company's engineering org, a personal workspace, a project namespace.

### `platform_managed`

The organization is created and managed by an external platform (e.g., Planton Cloud) via an IdentityProvider. The platform authenticates users and manages membership programmatically. Users never interact with Stigmer directly—they go through the platform.

```yaml
spec:
  management_mode: platform_managed
  identity_provider_ref:
    org: stigmer
    kind: identity_provider
    slug: planton-cloud-idp
  external_org_id: "planton-org-7a3f2c91"
```

Use `platform_managed` when you are building a product on top of Stigmer and want to provision namespaced AI agent capabilities for your own customers without requiring them to sign up for Stigmer directly.

**Key constraints for `platform_managed`:**

- `identity_provider_ref` is required and must point to an active IdentityProvider
- `external_org_id` stores the platform's own org identifier so it can reverse-lookup the Stigmer org even if the slugs differ
- Mode is immutable after creation

---

## Membership and Access Control

Every organization has members. Members have roles that determine what they can do:

| Role | Permissions |
|---|---|
| Owner | Full control, including delete and member management |
| Admin | Create, update, and manage resources; invite members |
| Member | View and use resources; create executions |

The creator of an organization automatically becomes its owner. Membership is managed via the IAM subsystem and is enforced by the Authorization Service on every API call.

---

## Slug Constraints

Organization slugs have stricter length limits than most other Stigmer resources:

- Lowercase letters (`a-z`), numbers (`0-9`), and hyphens only
- Must start with a lowercase letter
- **2–15 characters** (tighter than the 63-character limit on agents and skills)

```yaml
# Valid
slug: acme
slug: acme-corp
slug: my-org-2

# Invalid
slug: a                       # too short
slug: my-engineering-org      # too long (> 15 chars)
slug: 1acme                   # must start with a letter
slug: acme_corp               # underscores not allowed
```

The short limit encourages concise, memorable org identifiers that appear cleanly in the CLI, URLs, and cross-resource references.

---

## How Organizations Enable the Marketplace

Public visibility on agents and skills requires a stable organizational identity. When an org publishes a resource with `visibility: visibility_public`, the org slug becomes part of the resource's canonical reference:

```yaml
# Any user on the platform can reference this skill
skill_refs:
  - org: stigmer          # ← the publishing organization
    kind: skill
    slug: web-search
    version: stable
```

Without organizations, there is no trusted identity to publish from and no way to verify ownership of published resources. Organizations are what make the marketplace possible.

---

## How It Compares

| Without Organizations | With Stigmer Organizations |
|---|---|
| Resources in a flat global namespace | Every resource owned by an org; no accidental sharing |
| Credentials owned by individuals | Credentials scoped to an org; survive team changes |
| No team-level audit trail | Every change linked to an org, member, and timestamp |
| Discovery is word-of-mouth | Org slug is a stable discovery coordinate; `stigmer agent list --org acme-corp` |
| No marketplace identity | Public resources published under a verified org slug |
| Manual platform integration | `platform_managed` mode lets external platforms provision orgs programmatically |

---

## Getting Started

```bash
# 1. Create an organization YAML
cat > my-org.yaml << 'EOF'
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Acme Corp
  slug: acme-corp
spec:
  description: "Acme engineering organization"
EOF

# 2. Create it
stigmer org create my-org.yaml

# 3. See your organizations
stigmer org list

# 4. Inspect it
stigmer org get acme-corp --output yaml

# 5. Create resources inside it
stigmer agent apply agent.yaml   # where agent.yaml has metadata.org: acme-corp
```

---

## Further Reading

- [Organization YAML Schema Reference](../../apis/ai/stigmer/tenancy/organization/docs/organization-resource-guide.md) — Complete field documentation, management modes, and API operations
- [Examples](../../apis/ai/stigmer/tenancy/organization/docs/examples.md) — Complete YAML examples from minimal to platform-managed
- [Validation Checklist](../../apis/ai/stigmer/tenancy/organization/docs/validation-checklist.md) — Pre-apply checklist and common pitfalls
- [What is an Agent?](what-is-agent.md) — The primary resource type that lives inside organizations
- [What is a Skill?](what-is-skill.md) — Reusable knowledge packages scoped to an organization
- [What is an MCP Server?](what-is-mcp-server.md) — Tool integrations scoped to an organization
