# Grant Resource Documentation

Comprehensive documentation for the `iam.stigmer.ai/v1` Grant resource.

## What Is a Grant?

A Grant is a binding that gives a specific permission to a principal on a resource. Every access control decision in Stigmer traces back to one or more Grant records.

Each grant answers one question: **"Does [who] have [what permission] on [which resource]?"**

```
principal (WHO) ──► relation (WHAT) ──► resource (WHICH)

Example:
  identity_account:ia-alice-123  viewer  organization:org-demo-456
  "Alice can view the Demo organization"
```

Grants are the source of truth for authorization. They are synced to [OpenFGA](https://openfga.dev/) as relationship tuples, where all runtime authorization checks are evaluated.

## Core Concepts

| Concept | Detail |
|---|---|
| **Principal** | The entity being granted access. Can be an `identity_account`, `team`, `organization`, or any resource that acts as an identity. |
| **Resource** | The entity being protected. Can be any API resource: `organization`, `vault`, `agent`, `plugin`, etc. |
| **Relation** | The permission being granted. Maps to a role code (e.g., `admin`, `editor`, `viewer`, `owner`, `member`, `participant`, `user`); [Roles and general access](../../../../../../docs/sdk/resources/roles.mdx) lists each kind's. |
| **OpenFGA tuple** | The underlying representation. Each Grant produces a tuple: `principal_kind:principal_id#principal_relation@resource_kind:resource_id#relation`. |
| **Idempotency** | Creating a grant that already exists is a no-op — no error, no duplicate. |

## Authorization Model

```
Grant
  ├── spec.principal  ──► ApiResourceRef { kind, id, relation? }
  ├── spec.resource   ──► ApiResourceRef { kind, id }
  └── spec.relation   ──► "admin" | "editor" | "viewer" | "owner" | "member" | "participant" | "user" | ...
```

For team-based access, the principal's `relation` field qualifies which members of the team are included. For example, `{ kind: "team", id: "tm-123", relation: "member" }` means "all members of team tm-123", not just the team itself.

## Documentation Index

| Document | Description |
|---|---|
| [grant-resource-guide.md](grant-resource-guide.md) | YAML schema reference — spec fields, ApiResourceRef, CLI commands |
| [authorization-model.md](authorization-model.md) | OpenFGA integration, relation semantics, authorization query RPCs |
| [examples.md](examples.md) | Complete examples: granting access, revoking access, authorization checks |
| [validation-checklist.md](validation-checklist.md) | Pre-create checklist and common pitfalls |
