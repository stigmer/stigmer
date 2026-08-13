# Skill Versioning

Skills are the **only versioned resource type** in the Stigmer platform. This document explains how versions are created, identified, and resolved — and how to make the right choice between floating and pinned references.

## The Two-Layer Versioning Model

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
                                 hash: 1234ab...  (archived version)
```

## How Versions Are Created

A new version is created every time you push a skill with content that differs from the previous push.

```bash
stigmer push skill ./calculator         # creates version hash H1, tags "latest" → H1
# (edit SKILL.md)
stigmer push skill ./calculator         # creates version hash H2, tags "latest" → H2
stigmer push skill ./calculator --tag stable  # creates H3, tags "latest" → H3, "stable" → H3
```

**Version deduplication**: If you push the exact same content twice (same bytes, same ZIP), the SHA-256 hash is identical. The platform does not store a duplicate artifact. It updates the tag pointer to reference the existing version. From the platform's perspective, this is a no-op for storage but does move the tag.

```bash
# Push A: creates hash H1, tags "latest" → H1
stigmer push skill ./calculator

# No changes made to files

# Push B: same content → same hash H1
# Platform moves "latest" → H1 (already points there), no new artifact stored
stigmer push skill ./calculator
```

## Tag Behavior

### The `latest` Default

Every push assigns the `latest` tag unless you specify `--tag` with a different value. The `--tag latest` is the implicit default:

```bash
# These three commands are identical in effect
stigmer push skill
stigmer push skill --tag latest
stigmer push skill --tag LATEST  # tags are case-sensitive; this creates a "LATEST" tag, not "latest"
```

This means `latest` is always a live pointer to the most recently pushed version. Do not rely on `latest` for any production or reproducible workload.

### Moving a Tag

Pushing with the same tag name as a previous push moves the tag to the new version. The old version is not deleted — it remains accessible via its hash.

```bash
# First push: stable → H1
stigmer push skill ./calculator --tag stable

# Second push: stable → H2 (H1 is now only accessible via its hash)
stigmer push skill ./calculator --tag stable
```

### Multiple Tags on One Push

A single `stigmer push skill` call assigns exactly one tag. To assign multiple tags to the same content, push twice:

```bash
# Push once to get the hash and tag "latest"
stigmer push skill ./calculator

# Get the hash from the push output
# Push again with "stable" — same content → same hash, just moves the tag
stigmer push skill ./calculator --tag stable
```

Because the content hasn't changed, both pushes reference the same artifact.

### Tag Format Constraints

Tags must match `^$|^[a-zA-Z0-9._-]+$`. Valid examples:

```bash
# Correct
--tag stable
--tag v1.0.0
--tag 2024-01
--tag beta
--tag release_candidate

# Wrong — spaces not allowed
--tag "my tag"

# Wrong — forward slashes not allowed
--tag feature/new-behavior
```

## Version Resolution

When an agent references a skill, the platform resolves the `version` field in the `ApiResourceReference` to a specific artifact. See [Agent docs: resource-references.md](../agent/docs/resource-references.md) for the full reference format.

| `version` Value | Resolution |
|---|---|
| Empty or omitted | Resolves to the current `latest` tag. Equivalent to `version: latest`. |
| `latest` | Same as empty — resolves to the current `latest` tag. |
| Tag name (e.g., `stable`, `v1.0.0`) | Resolves to whichever hash the tag currently points to. Tags are mutable — this can change over time. |
| 64-character hex hash (e.g., `a1b2c3d4...`) | Resolves to that exact artifact. Immutable. Always the same content. |

Resolution happens at runtime — the platform reads the current tag-to-hash mapping each time an agent starts. An agent referencing `version: stable` may load different content today vs. next week if `stable` was moved in the meantime.

### Resolution Flow

```
AgentRef version field
        │
        ├── empty or "latest"  ──►  Current "latest" tag  ──►  hash  ──►  artifact
        │
        ├── tag name  ──────────►  Current tag mapping  ──►  hash  ──►  artifact
        │
        └── 64-char hash  ──────►  Direct artifact lookup  ──►  artifact
```

## Archived Versions

When a push updates a skill, the previous version is **archived**, not deleted. Archived versions are:

- Not visible in `stigmer list skills` output
- Not returned by `getByReference` when resolving `latest` or a tag name
- Still accessible via their hash (e.g., `version: a1b2c3d4...`)
- Still available for artifact download by the runner

The archive is permanent — there is no way to delete archived versions via the CLI. This ensures agents that were configured with a specific hash always have access to their artifact.

## Pinning Strategy

### When to Float (Use `latest` or a Tag Name)

Use floating references when:

- The skill is actively maintained and you want agents to pick up improvements automatically
- You are in a development or testing environment
- The skill's knowledge degrades if stale (e.g., a skill with current API documentation)

```yaml
# Agent YAML — floats to whatever "latest" points to
skill_refs:
  - org: acme-corp
    kind: skill
    slug: api-documentation
    # version omitted — resolves to latest
```

### When to Pin (Use a Hash)

Pin to a content hash when:

- The agent's behavior must be reproducible across environments (staging, production)
- You need to audit exactly which skill content an agent was using at a given time
- You are releasing the agent to production and need stability guarantees

```yaml
# Agent YAML — pinned to an immutable version
skill_refs:
  - org: acme-corp
    kind: skill
    slug: code-review-standards
    version: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
```

Get the hash from the push output or from `stigmer get skill <slug> --output yaml` → `status.version_hash`.

### When to Use a Named Tag

Named tags (not `latest`) offer a middle ground: the human intent is explicit (e.g., `stable` signals "this has been reviewed"), and you can update the tag when a new stable version is ready.

```yaml
# Explicit intent: use the version the team has designated as stable
skill_refs:
  - org: acme-corp
    kind: skill
    slug: deployment-procedures
    version: stable
```

Named tags are appropriate when:
- A team maintains the skill and governs tag promotions (only push `--tag stable` after review)
- You want to decouple agent update cadence from skill publish cadence
- Multiple agents share the same skill and you want coordinated updates

### Pinning Summary

| Reference | Reproducible? | Auto-updates? | Use For |
|---|---|---|---|
| `version: ""` (latest) | No | Yes, on every push | Development, always-current knowledge |
| `version: stable` | No | Yes, when tag is moved | Governed releases with coordinated updates |
| `version: a1b2c3...` (hash) | **Yes** | Never | Production, audit, reproducible pipelines |

## Versioning and the `spec.tag` Field

The `spec.tag` field on the Skill resource reflects the **last tag** that was assigned to the current version when it was pushed. It is informational — the authoritative tag-to-hash mapping is maintained by the platform, not by this field.

If a version was pushed with `--tag stable` and later the `stable` tag was moved to a newer version, the archived version's `spec.tag` still shows `stable` (recording what it was when it was active). Do not use `spec.tag` to determine current tag assignments.

## Related Documentation

- [skill-resource-guide.md](skill-resource-guide.md) — `status.version_hash`, `spec.tag`, and `SkillState` fields
- [publishing-skills.md](publishing-skills.md) — How pushes create and update versions
- [Agent docs: resource-references.md](../agent/docs/resource-references.md) — The `ApiResourceReference` format and `version` field semantics
- [Agent docs: skill-integration.md](../agent/docs/skill-integration.md) — How version resolution works at agent runtime
