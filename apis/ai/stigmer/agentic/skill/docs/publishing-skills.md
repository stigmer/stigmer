# Publishing Skills

How to push skill artifacts to the platform — from the CLI directly, from a remote git repository, and via the Go SDK.

## Overview

Publishing a skill means pushing a packaged artifact to the platform so agents can reference and use it. The platform stores the artifact, extracts the skill metadata from `SKILL.md`, computes a SHA-256 version hash, and records git provenance if available.

There are three paths to publishing a skill:

| Path | Use When |
|---|---|
| **CLI local push** | Working directly on a skill directory on your machine |
| **CLI remote push** | Sourcing a skill from a git repository (no local clone required) |
| **SDK handover** | Declaring skills as code in a Stigmer project; the SDK writes a `SkillSynth` protobuf that the CLI processes |

## CLI Local Push

The most common path. Point the CLI at a local directory containing `SKILL.md`.

```bash
# Push from the current directory
stigmer push skill

# Push from a specific directory
stigmer push skill ./skills/calculator
```

### What the CLI Does

1. Validates that `SKILL.md` exists in the directory.
2. Reads `.gitignore` (if present) and `.stigmerignore` (if present) to determine which files to exclude.
3. Packages the filtered directory into a ZIP artifact.
4. Auto-detects git provenance if the directory is within a git repository (reads the `origin` remote URL, current branch, and resolves the HEAD commit SHA).
5. Calls `PushSkillRequest` with the artifact bytes, org, tag, and git provenance.

### Git Provenance Auto-Detection

When the skill directory is inside a git repository, the CLI automatically populates `GitProvenance`:

| Field | Source |
|---|---|
| `remote_url` | `git remote get-url origin` |
| `ref` | Current branch name (empty if detached HEAD) |
| `commit` | `git rev-parse HEAD` (full 40-character SHA) |
| `subdir` | Path of the skill directory relative to the git repo root |

Provenance is absent when the skill directory is not within a git repository. No error is produced — the push proceeds without provenance metadata.

### Tag Behavior

Every push assigns a tag to the resulting version. The default is `latest`.

```bash
# These two commands are equivalent — both tag with "latest"
stigmer push skill
stigmer push skill --tag latest

# Tag with a specific name
stigmer push skill --tag stable
stigmer push skill --tag v1.0.0
```

`latest` is a mutable tag that moves with every untagged push. If multiple people or pipelines push the same skill without specifying a tag, they all move `latest`. For production agents, pin skills to a specific tag or hash. See [versioning.md](versioning.md).

### Dry Run

Preview exactly what the platform would receive without pushing anything:

```bash
# Show file count, size, and which files would be included
stigmer push skill --dry-run

# Show per-file include/exclude decisions
stigmer push skill --dry-run --verbose
```

Dry run validates the directory structure and `SKILL.md` presence but does not call the backend.

## CLI Remote Push

Push a skill sourced directly from a git repository. The CLI clones the repository, locates the skill, and pushes it — no local copy of the repository is needed beforehand.

```bash
stigmer push skill \
  --git-url https://github.com/acme-corp/skills.git \
  --git-ref v1.0.0 \
  --subdir skills/calculator \
  --tag stable
```

### What the CLI Does

1. Clones the repository to a temporary directory (shallow clone for branches/tags; full clone for commit SHAs).
2. Checks out the specified `--git-ref` (defaults to the repository's default branch if not specified).
3. Navigates to `--subdir` within the clone (root of the repo if not specified).
4. Validates that `SKILL.md` exists.
5. Packages the directory into a ZIP artifact, applying ignore rules.
6. Populates `GitProvenance` from the provided URL, ref, and resolved commit SHA.
7. Calls `PushSkillRequest`.
8. Deletes the temporary clone.

### Remote Push Flags

| Flag | Default | Description |
|---|---|---|
| `--git-url <url>` | — | Git repository URL (HTTPS or SSH). Required for remote push. |
| `--git-ref <ref>` | Default branch | Tag, branch name, or commit SHA to check out. |
| `--subdir <path>` | Repo root | Subdirectory within the repository containing `SKILL.md`. |
| `--tag <tag>` | `latest` | Version tag to assign to the resulting skill version. |

```bash
# From a tag
stigmer push skill --git-url https://github.com/acme/skills.git --git-ref v2.1.0

# From a specific commit SHA
stigmer push skill --git-url https://github.com/acme/skills.git --git-ref abc123def456

# From the main branch, subdirectory
stigmer push skill --git-url https://github.com/acme/skills.git --subdir skills/web-scraper

# SSH URL (uses locally configured git credentials)
stigmer push skill --git-url git@github.com:acme-corp/skills.git --git-ref main
```

## SDK Handover (Go SDK)

When a Stigmer project is authored in Go, skill publishing is declared in code using the SDK. The SDK writes a `SkillSynth` protobuf file that the CLI reads and processes.

### Flow

```
SDK code  ──►  skill.FromDir() or skill.FromGit()  ──►  Writes .stigmer/skill-N.pb
                                                              │
CLI reads  ──────────────────────────────────────────────────┘
  .stigmer/skill-N.pb
  │
  └──►  Follows source (local or git)  ──►  Packages artifact  ──►  PushSkillRequest
```

The SDK does not push the skill directly. It declares the skill's source and registers it with the Stigmer context. The CLI reads the registered skills when the project is built and handles the actual push.

### Declaring a Local Directory Skill

```go
import (
    "github.com/stigmer/stigmer/sdk/go/v3/skill"
    stigmer "github.com/stigmer/stigmer/sdk/go/v3"
)

stigmer.Run(func(ctx *stigmer.Context) error {
    // From a path relative to the project root
    calc, err := skill.FromDir(ctx, "./skills/calculator")
    if err != nil {
        return err
    }
    _ = calc  // calc is registered with ctx automatically

    // With an explicit version tag
    webSearch, err := skill.FromDir(ctx, "./skills/web-search",
        skill.WithTag("stable"))
    if err != nil {
        return err
    }
    _ = webSearch

    return nil
})
```

### Declaring a Remote Git Skill

```go
stigmer.Run(func(ctx *stigmer.Context) error {
    // From a git repository root
    calc, err := skill.FromGit(ctx, "https://github.com/acme-corp/skills.git",
        skill.WithRef("v1.0.0"),
        skill.WithSubdir("skills/calculator"),
        skill.WithGitTag("stable"))
    if err != nil {
        return err
    }
    _ = calc

    // From default branch (no ref specified)
    shared, err := skill.FromGit(ctx, "https://github.com/stigmer/platform-skills.git",
        skill.WithSubdir("formatting"))
    if err != nil {
        return err
    }
    _ = shared

    return nil
})
```

### SDK Options Reference

**`skill.FromDir(ctx, path, opts...)`** options:

| Option | Description |
|---|---|
| `skill.WithTag(tag string)` | Version tag to assign. Defaults to `latest` if not specified. |

**`skill.FromGit(ctx, url, opts...)`** options:

| Option | Description |
|---|---|
| `skill.WithRef(ref string)` | Git tag, branch, or commit SHA. Defaults to the repository's default branch. |
| `skill.WithSubdir(subdir string)` | Subdirectory within the repository containing `SKILL.md`. |
| `skill.WithGitTag(tag string)` | Version tag to assign to the resulting skill version. |

## Backend Processing

Once the CLI calls `PushSkillRequest`, the backend performs the following steps in order:

1. **Normalize name**: Convert the skill name from `SKILL.md` frontmatter to a slug (e.g., `"My Calculator"` → `my-calculator`).
2. **Find or create skill resource**: Look up the skill by org + slug. Create a new Skill resource if it doesn't exist.
3. **Extract `SKILL.md`**: Read and parse the frontmatter to extract `name`, `description`, and `version`.
4. **Calculate SHA-256 hash**: Compute the content fingerprint of the ZIP artifact. This becomes the immutable `version_hash`.
5. **Deduplicate**: If a version with the same hash already exists, no new artifact is stored. The tag pointer is updated to reference the existing version.
6. **Store artifact**: Upload the ZIP to storage (`skills/<slug>_<hash>.zip`).
7. **Update `SkillSpec`**: Write `name`, `description`, `tag`, and `skill_md` to the spec.
8. **Update `SkillStatus`**: Set `version_hash`, `artifact_storage_key`, `state: SKILL_STATE_READY`, and `git_provenance`.
9. **Archive previous version**: Mark the previous version as archived. It is not deleted — archived versions remain accessible by their hash.

## First Push vs. Update Semantics

### First Push

Creates a new Skill resource with the provided name (normalized to a slug). The org + slug pair must not already exist under a different name.

```bash
# First push — creates the skill
stigmer push skill ./skills/calculator
# → Creates skill: org=local, slug=calculator
```

### Subsequent Pushes

Finds the existing skill by org + slug and creates a new version. The tag pointer moves to the new version.

```bash
# Second push — updates the skill, moves "latest" tag
stigmer push skill ./skills/calculator
# → Existing skill: org=local, slug=calculator
# → New version hash: <new_sha256>
# → "latest" tag now points to new version

# Pin the stable tag separately
stigmer push skill ./skills/calculator --tag stable
# → "stable" tag now points to new version
# → "latest" was moved by the previous push
```

### Naming a Skill from a Different Path

A skill's identity on the platform is determined by its org + slug. If you have two directories with different names but identical `SKILL.md` frontmatter `name` fields, they produce the same skill. If you push a skill with a `name` that already exists under a different slug in the org, the push fails.

## Related Documentation

- [skill-resource-guide.md](skill-resource-guide.md) — What the platform stores after a push
- [versioning.md](versioning.md) — How content hashes, tags, and version resolution work
- [skill-md-format.md](skill-md-format.md) — How to author `SKILL.md`
- [examples.md](examples.md) — Complete examples for all push modes
- [validation-checklist.md](validation-checklist.md) — Pre-push checklist
