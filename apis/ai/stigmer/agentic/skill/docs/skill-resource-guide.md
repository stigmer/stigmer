# Skill API Resource Reference

Schema reference for the `agentic.stigmer.ai/v1` Skill resource. For conceptual overview and lifecycle, see [README.md](README.md).

## Important: Skills Are Not YAML Resources

Unlike Agents, a Skill resource is **not authored as a YAML file**. The platform creates and populates the Skill resource automatically when you run `stigmer push skill`. The fields documented here describe what the platform stores — you never write this YAML manually.

This document exists to help you understand what the platform records so you can inspect, query, and reference skills accurately.

## Skill Resource Shape

A Skill resource as returned by `stigmer get skill <ref> --output yaml`:

```yaml
api_version: agentic.stigmer.ai/v1
kind: Skill
metadata:
  id: skl_01abc123def456789
  name: calculator
  slug: calculator
  org: acme-corp
  visibility: visibility_private
spec:
  name: calculator
  description: "Performs arithmetic operations and evaluates mathematical expressions"
  tag: stable
  skill_md: |
    ---
    name: calculator
    description: Performs arithmetic operations and evaluates mathematical expressions
    ---
    # Calculator Skill
    ...
status:
  version_hash: "a1b2c3d4e5f6..."
  artifact_storage_key: "skills/calculator_a1b2c3d4.zip"
  state: SKILL_STATE_READY
  git_provenance:
    remote_url: "https://github.com/acme-corp/skills.git"
    ref: "main"
    commit: "abc123def456789012345678901234567890abcd"
    subdir: "skills/calculator"
  audit:
    spec_audit:
      created_by: "usr_xyz"
      created_at: "2024-01-15T10:30:00Z"
      updated_at: "2024-01-15T10:30:00Z"
```

## Top-Level Fields

| Field | Set By | Value |
|---|---|---|
| `api_version` | System | Always `agentic.stigmer.ai/v1` |
| `kind` | System | Always `Skill` |
| `metadata` | Derived from artifact + org context | See below |
| `spec` | Extracted from `SKILL.md` artifact | See below |
| `status` | System-managed observed state | See below |

## Metadata Fields

All metadata fields are defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Description |
|---|---|
| `metadata.id` | System-generated unique identifier. Format: `skl_<ulid>`. Never set by users. |
| `metadata.name` | Canonical display name. Set from `SKILL.md` frontmatter `name` field after normalization. |
| `metadata.slug` | URL-friendly identifier, unique within the organization. Derived from the frontmatter `name` field (normalized to kebab-case; dots in the name become hyphens, e.g. `platform.planton-architecture` → `platform-planton-architecture`). |
| `metadata.org` | Organization that owns this skill. Provided at push time via `--org` flag or CLI context. Every skill belongs to exactly one organization. |
| `metadata.visibility` | Access control. `visibility_private` (default): only org members can access. `visibility_public`: anyone can read. |
| `metadata.labels` | Key-value pairs for organization and filtering. Not extracted from the artifact — set via API if needed. |
| `metadata.annotations` | Key-value pairs for additional metadata. Not extracted from the artifact — set via API if needed. |
| `metadata.tags` | String array for categorization. Not the same as skill version tags. |
| `metadata.version` | System-managed version tracking for the metadata record itself. Not related to the skill artifact version hash. |

### Visibility

```yaml
# Private skill (default) — only your org can use it
metadata:
  visibility: visibility_private

# Public skill — visible to and usable by everyone
metadata:
  visibility: visibility_public
```

### Organization

Every skill belongs to exactly one organization. The org is set at push time.

The CLI resolves the organization through a priority chain: `--org` flag > `context.organization` in config > error. On first server start, a `default` organization is bootstrapped automatically.

## Spec Fields

`SkillSpec` fields are defined in `ai/stigmer/agentic/skill/v1/spec.proto`. All fields are **extracted by the backend from the artifact** — they are not user-authored inputs.

| Field | Source | Description |
|---|---|---|
| `spec.name` | `SKILL.md` frontmatter `name` field | Canonical skill identifier in kebab-case, optionally scoped with dot-separated namespaces. Examples: `calculator`, `web-scraper`, `platform.planton-architecture`. Pattern: `^[a-z0-9]+([.-][a-z0-9]+)*$`. |
| `spec.description` | `SKILL.md` frontmatter `description` field | Human-readable summary for marketplace display and prompt injection. 1-2 sentences, ideally under 100 tokens. |
| `spec.tag` | `--tag` flag at push time | The version tag associated with this version. Defaults to `latest` if no tag was specified at push. Tags are mutable pointers — see [versioning.md](versioning.md). |
| `spec.skill_md` | Full content of `SKILL.md` | The complete `SKILL.md` file content, including frontmatter and body. This is the content injected into agent prompts. Minimum 1 character (enforced by `buf.validate`). |

## Status Fields

`SkillStatus` is system-managed and reflects observed state. Never set these fields.

| Field | Description |
|---|---|
| `status.version_hash` | SHA-256 hash of the artifact ZIP file. This is the immutable version identifier. Pattern: `^[a-f0-9]{64}$`. Two pushes of identical content produce the same hash. |
| `status.artifact_storage_key` | Storage location of the ZIP artifact. Format: `skills/<slug>_<hash>.zip` (cloud) or `<hash>.zip` (local). Opaque — use the CLI or API to retrieve artifacts. |
| `status.state` | Current lifecycle state. See [Skill States](#skill-states) below. |
| `status.git_provenance` | Git origin of the artifact. Present only when pushed from or as a git repository. See [Git Provenance](#git-provenance) below. |
| `status.audit` | Standard audit record: `created_by`, `created_at`, `updated_by`, `updated_at` for both spec and status. |

### Skill States

`SkillState` is defined in `ai/stigmer/agentic/skill/v1/status.proto`.

| State | Meaning |
|---|---|
| `SKILL_STATE_UPLOADING` | The CLI is uploading the artifact ZIP to storage. The skill resource exists but is not yet usable. |
| `SKILL_STATE_READY` | The artifact is stored and the skill is fully usable by agents. |
| `SKILL_STATE_FAILED` | Upload or processing failed. The artifact may be incomplete. Re-push to recover. |

State transitions:

```
UPLOADING ──► READY
    │
    └────────► FAILED
```

A skill in `FAILED` state should be re-pushed. The platform does not retry failed uploads automatically.

### Git Provenance

`GitProvenance` is defined in `ai/stigmer/agentic/skill/v1/status.proto`. It records where the artifact originated, enabling "view on GitHub" links and reproducible deployments.

| Field | Description |
|---|---|
| `git_provenance.remote_url` | Git remote URL. For local push: the `origin` remote of the skill directory's git repository. For remote push: the URL provided via `--git-url`. Example: `https://github.com/acme-corp/skills.git`. |
| `git_provenance.ref` | Original git reference (display only). For local push: the branch name (e.g., `main`) or empty if detached HEAD. For remote push: the value of `--git-ref`. |
| `git_provenance.commit` | Resolved commit SHA (immutable, 40 characters). Always populated — this is the reproducible reference. |
| `git_provenance.subdir` | Subdirectory path relative to repo root. Empty if the skill is at the repo root. Example: `skills/calculator`. |

`git_provenance` is absent when the skill is pushed from a directory that is not within a git repository.

## CLI Commands

The Stigmer CLI uses a unified command pattern. All skill operations use `stigmer <verb> skill` — not `stigmer skill <verb>`.

```bash
# Push a skill from the current directory (--tag defaults to "latest")
stigmer push skill

# Push from a specific directory
stigmer push skill ./skills/calculator

# Push with an explicit tag
stigmer push skill --tag stable
stigmer push skill ./skills/calculator --tag v1.0.0

# Push to a specific organization
stigmer push skill --org acme-corp

# Validate the artifact without pushing
stigmer push skill --dry-run

# Push from a remote git repository
stigmer push skill --git-url https://github.com/acme-corp/skills.git \
  --git-ref v1.0.0 \
  --subdir skills/calculator \
  --tag stable

# Exclude files from the artifact (gitignore-compatible patterns)
stigmer push skill --ignore "*.tmp" --ignore "draft/**"

# Force-include a file that would otherwise be ignored
stigmer push skill --include ".env.example"

# Disable .gitignore-based filtering
stigmer push skill --no-gitignore

# Show detailed output including file include/exclude decisions
stigmer push skill --verbose

# Get a skill by slug, org/slug, or resource ID
stigmer get skill calculator
stigmer get skill acme-corp/calculator
stigmer get skill skl_01abc123

# Get as YAML or JSON
stigmer get skill calculator --output yaml
stigmer get skill calculator --output json

# List all skills in the current org
stigmer list skills

# List skills with a limit
stigmer list skills --limit 20

# List skills from a specific org
stigmer list skills --org acme-corp

# Delete a skill and all its versions
stigmer delete skill calculator
stigmer delete skill calculator --force  # skip confirmation prompt
```

### Push Flags Reference

| Flag | Default | Description |
|---|---|---|
| `--tag <tag>` | `latest` | Version tag to associate with this push. |
| `--org <org>` | CLI context | Organization to push into. |
| `--dry-run` | `false` | Analyze the artifact without pushing. Shows file count, size, and which files would be included. |
| `--git-url <url>` | — | Push from a remote git repository instead of a local directory. |
| `--git-ref <ref>` | default branch | Git tag, branch, or commit SHA for remote push. |
| `--subdir <path>` | repo root | Subdirectory within the git repository containing `SKILL.md`. |
| `--ignore <pattern>` | — | Additional file patterns to exclude (repeatable). Gitignore syntax. |
| `--include <pattern>` | — | File patterns to force-include even if they would be ignored (repeatable). |
| `--no-gitignore` | `false` | Disable `.gitignore`-based filtering. All files in the directory are included. |
| `--verbose` | `false` | Show per-file include/exclude decisions during packaging. |

## Related Documentation

- [README.md](README.md) — Overview, lifecycle, and table of contents
- [skill-md-format.md](skill-md-format.md) — How to author `SKILL.md` and structure the skill package
- [publishing-skills.md](publishing-skills.md) — Push workflow, git provenance, and tag behavior
- [versioning.md](versioning.md) — Content hashes, tags, and version resolution
- [examples.md](examples.md) — Complete examples
- [validation-checklist.md](validation-checklist.md) — Pre-push checklist and common pitfalls
- [Agent docs: skill-integration.md](../agent/docs/skill-integration.md) — How agents consume skills at runtime
- [Agent docs: resource-references.md](../agent/docs/resource-references.md) — `ApiResourceReference` format for referencing skills from agents
