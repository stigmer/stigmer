# ApiResourceReference Format

When an Agent references another resource (plugin, skill, or an agent it lists as a subagent), it uses the `ApiResourceReference` message defined in `ai/stigmer/commons/apiresource/io.proto`. This document is the single source of truth for that format, for what a reference survives, and for when the version it asks for is read.

## YAML Format

```yaml
kind: skill
slug: variance-report
version: stable
```

## Fields

| Field | Required | Format | Description |
|---|---|---|---|
| `org` | No | `^$\|^[a-z][a-z0-9-]*[a-z0-9]$\|^org_[0-9a-z]{26}$`, at most 63 chars | Organization that owns the referenced resource, by slug or id. Empty = relative reference (resolved from the parent resource's `metadata.org` at write time). |
| `kind` | No | Lowercase string enum name | Resource kind. The field the reference sits in decides it; a reference that names another kind is refused. See [Kind Values](#kind-values). |
| `id` | One of `id` or `slug` | A resource id, at most 64 chars | The target's id, which a stored reference holds. |
| `slug` | One of `id` or `slug` | `^[a-z][a-z0-9-]*[a-z0-9]$`, 2 to 63 chars | The target's slug, unique within the organization. |
| `version` | No | Tag, hash, or empty | The version asked for. Read by skills, plugins and subagents; ignored for every other kind. See [When a Version Is Read](#when-a-version-is-read). |

## Three Forms

A reference is written one way, stored another, and returned a third.

| Form | What it holds |
|---|---|
| Written | The target by name (`org` and `slug`), by `id`, or by both. When both are given they must name the same resource, or the write is refused naming both. |
| Stored | `org` (the organization's id), `kind`, `id` and `version`. The slug is resolved to the id when the referring resource is written, and is not stored. |
| Returned | As stored, with `slug` filled with the target's current slug, or empty once the target is deleted. |

Write references by slug: that is what a person reads and types, and what a manifest kept in a repository should hold. The id is what the server keeps.

## What a Reference Survives

**A rename.** Renaming the target changes nothing the reference holds. The agent keeps loading the same skill, and every response names it by its new slug. The old slug keeps leading to the target for reading for 30 days, so a manifest that still names it can be corrected; an apply of that manifest is refused with `SLUG_RENAMED` until it names the new slug or the id.

**A delete.** A reference whose target was deleted is returned with an empty `slug` and its `id`. A turn runs without a skill or plugin that was deleted. A new resource that later takes the deleted one's name is never bound to the stored reference: only a write that names the slug again resolves it to the new resource.

## Kind Values

The `kind` field uses the **lowercase string name** of the `ApiResourceKind` enum. In YAML, always use the string form (`kind: skill`), never the integer and never a capitalized name. It may be left out: the field decides the kind (`skill_refs` holds skills, `plugins` plugins, `subagents` agents), and a reference that names another kind is refused with `skill_refs must reference resources with kind=skill`.

| YAML Value | Resource Type |
|---|---|
| `skill` | Skill — reusable knowledge package |
| `plugin` | Plugin — an installed package of skills, agents, hooks and MCP servers |
| `agent` | Agent — a saved agent this agent lists in `subagents` |

## Organization (`org`)

The `org` field identifies which organization owns the referenced resource. It supports two modes:

### Relative References (Recommended)

Omit the `org` field to create a relative reference. The server resolves the organization from the parent resource's `metadata.org` at write time. This makes YAML portable across organizations.

```yaml
# Relative — org resolved from the agent's metadata.org
skill_refs:
  - kind: skill
    slug: variance-report
```

### Absolute References

Set `org` explicitly when referencing a resource in a different organization. The server accepts it only when that organization is your organization's parent and shares the resource with its children at `visibility_child_orgs`; any other cross-organization reference is refused at write, and a missing target is refused with the same sentence (the rule never says whether another organization's slug exists). To use another organization's skill or MCP server otherwise, install the plugin that carries it and reference your own copy.

```yaml
# Absolute — a skill the parent organization shares with its child organizations
skill_refs:
  - org: acme-cloud
    kind: skill
    slug: chart-of-accounts

# Absolute — referencing a resource in your own org (explicit)
skill_refs:
  - org: acme-corp
    kind: skill
    slug: internal-style-guide
```

### Canonical Format

References are canonically represented as `org/slug` (e.g., `stigmer/web-search`, `acme-corp/data-analyst`). This format appears in logs, the UI, and API responses.

## Slug

Slugs are user-friendly identifiers that are unique within an organization. Format constraints:

- Lowercase alphanumeric characters and hyphens only
- Must start with a letter and end with a letter or digit
- 2 to 63 characters long

```yaml
# Correct
slug: variance-reporter
```

`Variance_Reporter` (uppercase and underscores), `varianceReporter` (camelCase) and `2nd-reporter` (starts with a digit) are refused.

## When a Version Is Read

The `version` field is read by three kinds: skills, plugins, and agents listed in `subagents`. Every other kind ignores it.

| Value | Asks for |
|---|---|
| Empty or omitted | The latest version |
| `latest` | The latest version (same as empty) |
| Tag name (e.g., `stable`, `v1.0`) | The version the tag names |
| 64-character hex hash | That exact version, which never changes |

**Skills and plugins are read at the start of each turn.** A reference without a hash follows each new push: a turn that starts after a push loads the new version, and a tag that moves takes the next turn with it. Each run records the exact version every turn loaded (`RunStatus.loaded_versions`), and the conversation marks a turn whose skills or plugins moved since the turn before. A plugin's versions are its archive digests, each tagged with the manifest's `version`; a plugin reference with no `version` follows the installed version.

**Subagents are read when the agent that lists them is saved.** The saved reference carries the hash its version resolved to, so a later move of a tag, or a new version of the listed agent, changes nothing until the agent is saved again ([subagents.md](subagents.md#which-version-runs)).

**A session adds to its agent's lists.** A session's `skill_refs` and `plugins` are loaded beside the agent's at each turn. When both name the same skill or plugin, the session's reference wins.

```yaml
# Follow the latest version
skill_refs:
  - kind: skill
    slug: variance-report

# Follow a named tag
skill_refs:
  - kind: skill
    slug: variance-report
    version: stable

# Pin to an exact content hash
skill_refs:
  - kind: skill
    slug: variance-report
    version: "a1b2c3d4e5f6..."
```

Tags are mutable pointers — `stable` may point to different content over time. Content hashes are immutable — they always resolve to the exact same version. Use tags for flexibility, hashes for reproducibility.

## Validation Rules

The proto enforces these constraints via `buf.validate`:

- `org`: optional, matches `^$|^[a-z][a-z0-9-]*[a-z0-9]$|^org_[0-9a-z]{26}$`, at most 63 chars (empty string allowed for relative references)
- `id`: optional, at most 64 chars
- `slug`: optional when `id` is set, matches `^[a-z][a-z0-9-]*[a-z0-9]$`, 2 to 63 chars
- `id` or `slug`: one of them is required (`reference.id_or_slug`)
- `version`: optional, matches `^$|^latest$|^[a-zA-Z0-9._-]+$|^[a-f0-9]{64}$`

Each reference field of the contract declares the kind it holds with the `reference_kind` field option: on an Agent, `plugins` holds plugins, `skill_refs` skills, and `subagents` agents (at most 20 entries). When the agent is written, every reference is checked: the target must exist, and one in another organization must be shared as above. A reference that fails is refused at write, never at run.
