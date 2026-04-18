# Organization Resource Documentation

Comprehensive documentation for the `tenancy.stigmer.ai/v1` Organization resource.

## What Is an Organization?

An Organization is the **top-level container** for all Stigmer resources. Similar to GitHub organizations, every agent, workflow, MCP server, skill, and session belongs to exactly one organization. Organizations provide multi-tenancy, resource isolation, and access control boundaries.

All other Stigmer resources reference their owning organization through `metadata.org`. You must have an organization before creating any other resource.

## Organization Lifecycle

```
User ──► Organization ──► Members ──► Resources (Agents, Workflows, MCP Servers, Skills…)
```

| Concept | Description |
|---|---|
| **Organization** | The root namespace for all resources. Created once, referenced everywhere. |
| **Member** | A user granted access to an organization via the IAM subsystem. The creator automatically becomes the owner. |
| **Resources** | Agents, workflows, MCP servers, skills, sessions, and executions all live under an organization. |

## Management Modes

Organizations have two management modes, set at creation time and **immutable** thereafter:

| Mode | Description |
|---|---|
| `self_managed` | Default. Created and operated directly by users via the Stigmer UI, CLI, or API. |
| `platform_managed` | Created programmatically by an external platform (e.g., Planton) via an IdentityProvider. The platform manages the org on behalf of its users. |

## Documentation Index

| Document | Description |
|---|---|
| [organization-resource-guide.md](organization-resource-guide.md) | Core YAML schema reference — metadata, spec fields, status, and CLI commands |
| [examples.md](examples.md) | Complete YAML examples from minimal self-managed to platform-managed |
| [validation-checklist.md](validation-checklist.md) | Pre-apply checklist and common pitfalls |

## CLI Quick Reference

```bash
# Create a new organization
stigmer org create org.yaml

# Apply (create or update) an organization from a YAML file
stigmer org apply org.yaml

# List organizations you are a member of
stigmer org list

# Get organization details
stigmer org get my-org

# Get organization details as YAML
stigmer org get my-org --output yaml

# Update an existing organization
stigmer org update org.yaml

# Delete an organization (cascades to all resources)
stigmer org delete my-org
```
