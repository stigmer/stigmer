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
| **Member** | A user granted access to an organization via the IAM subsystem. The creator automatically becomes the owner (a child organization's parent admins grant its first members instead). |
| **Resources** | Agents, workflows, MCP servers, skills, sessions, and runs all live under an organization. |

## Parent and Child Organizations

An organization may name a parent organization in `spec.parent_org`: it is then a **child organization**, such as the organization an integrator runs for one of its customers. Child organizations are one level deep, and both `spec.parent_org` and the parent's own identifier for the child, `spec.external_id`, are fixed at creation.

| Who | What they can do in a child organization |
|---|---|
| The parent's admins | Manage it: rename it, edit its settings, manage its members and access, see its bill, delete it. They read none of its agents, sessions or files. To look inside, one adds themselves as a member, which the child's member list and access history show. |
| The child's own members | Everything their role in the child allows, plus read and run what the parent shares with its child organizations (`visibility_child_orgs`). |

A child has no creator owner: the parent's admins grant its first members and its owner. A parent that still has children cannot be deleted. The parent finds a child by its external id (`getByExternalId`) and lists its children (`listChildOrgs`); a sign-in through the parent's identity provider whose `external_id_claim` carries a child's external id lands in that child.

## Documentation Index

| Document | Description |
|---|---|
| [organization-resource-guide.md](organization-resource-guide.md) | Core YAML schema reference — metadata, spec fields, status, and CLI commands |
| [examples.md](examples.md) | Complete YAML examples, from a minimal organization to a child organization |
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

# Delete an organization (irreversible; its slug is released)
stigmer org delete my-org
```
