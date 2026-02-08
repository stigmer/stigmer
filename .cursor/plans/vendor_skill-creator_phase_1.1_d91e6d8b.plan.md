---
name: Vendor skill-creator Phase 1.1
overview: Vendor Anthropic's skill-creator skill into the CLI binary with full provenance tracking. This establishes the foundation for Stigmer's self-bootstrapping agent system by embedding a trusted skill that can create new skills.
todos:
  - id: create-seedpack-dirs
    content: Create internal/seedpack/tools/ and internal/seedpack/skills/ directory structure
    status: completed
  - id: create-vendor-script
    content: Create vendor_skill.sh with clone, copy, digest calculation, and provenance generation
    status: completed
  - id: execute-vendoring
    content: Run vendor_skill.sh to vendor skill-creator from Anthropic (pins to current HEAD)
    status: completed
  - id: verify-content
    content: Verify SKILL.md parses, LICENSE present, all files accounted for, provenance valid
    status: completed
  - id: add-bazel-build
    content: Add BUILD.bazel for the seedpack package (optional - may defer to Phase 1.3)
    status: completed
isProject: false
---

# Phase 1.1: Vendor Anthropic's skill-creator

## Goal

Create a reproducible, automated vendoring system that embeds Anthropic's skill-creator into the Stigmer CLI with full provenance tracking (git URL, commit SHA, content digest).

## What We're Vendoring

From `https://github.com/anthropics/skills/tree/main/skills/skill-creator`:

```
skill-creator/
├── SKILL.md              # ~18KB - Main skill instructions
├── LICENSE.txt           # ~11KB - Apache 2.0 license
├── scripts/
│   ├── init_skill.py     # ~11KB - Skill initialization script
│   ├── package_skill.py  # ~3KB  - Skill packaging script
│   └── quick_validate.py # ~4KB  - Validation script
└── references/
    ├── output-patterns.md  # ~2KB - Output pattern guidance
    └── workflows.md        # ~1KB - Workflow patterns
```

Total: ~50KB of content

## Target Directory Structure

```
client-apps/cli/internal/seedpack/
├── skills/
│   └── skill-creator/
│       ├── SKILL.md
│       ├── LICENSE.txt
│       ├── provenance.json    # NEW: Origin tracking
│       ├── scripts/
│       │   ├── init_skill.py
│       │   ├── package_skill.py
│       │   └── quick_validate.py
│       └── references/
│           ├── output-patterns.md
│           └── workflows.md
└── tools/
    └── vendor_skill.sh        # NEW: Reproducible vendoring script
```

## Implementation Approach

### Part 1: Create the Vendoring Script

Create `client-apps/cli/internal/seedpack/tools/vendor_skill.sh`:

```bash
#!/usr/bin/env bash
# Vendors a skill from the Anthropic skills repository
# Usage: ./vendor_skill.sh <skill-name> [commit-sha]

set -euo pipefail

# Key characteristics:
# - Reproducible: same commit = same output
# - Auditable: records full provenance
# - Verifiable: includes content digest
```

The script will:

1. Clone repo to temp directory (shallow if no specific commit)
2. Checkout specific commit if provided, else use HEAD
3. Copy skill directory to seedpack
4. Calculate SHA256 digest of all content
5. Generate `provenance.json` with full tracking

### Part 2: Provenance JSON Schema

[provenance.json](client-apps/cli/internal/seedpack/skills/skill-creator/provenance.json):

```json
{
  "schema_version": "1",
  "source": {
    "type": "git",
    "url": "https://github.com/anthropics/skills",
    "ref": "main",
    "commit_sha": "<40-char-sha>",
    "subdir": "skills/skill-creator"
  },
  "vendored_at": "2026-02-08T...",
  "vendored_by": "vendor_skill.sh",
  "content_digest": "sha256:<64-char-hex>",
  "files": [
    {"path": "SKILL.md", "digest": "sha256:..."},
    {"path": "LICENSE.txt", "digest": "sha256:..."},
    ...
  ]
}
```

Design rationale:

- `schema_version` allows future format evolution
- Per-file digests enable targeted verification
- `vendored_by` tracks which tool created this

### Part 3: Execute Vendoring

Run the script to vendor skill-creator:

```bash
cd client-apps/cli/internal/seedpack
./tools/vendor_skill.sh skill-creator
```

This captures current HEAD and creates all files with proper provenance.

### Part 4: Verify Vendored Content

Validation checks:

- SKILL.md parses correctly (use existing `artifact.ParseSkillMetadata`)
- LICENSE.txt is present (Apache 2.0)
- All scripts are present and non-empty
- provenance.json is valid JSON with all required fields

## Existing Code Leverage

- [internal/cli/artifact/skillmd.go](client-apps/cli/internal/cli/artifact/skillmd.go) - SKILL.md parsing already implemented
  - `ParseSkillMetadata()` extracts YAML frontmatter
  - `extractFrontmatter()` handles the `---` delimiters
  - Can be reused to validate vendored SKILL.md

## Key Design Decisions


| Decision                       | Rationale                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------- |
| Vendoring script vs manual     | Reproducibility for future updates (aligns with Phase 6.1 `stigmer seed update`) |
| Per-file digests in provenance | Enables targeted verification and diff detection                                 |
| Shallow clone by default       | Faster vendoring, full history not needed                                        |
| Schema version in provenance   | Future-proofs the format                                                         |


## Verification Criteria

1. `provenance.json` exists with valid schema
2. SKILL.md frontmatter parses correctly (name: `skill-creator`)
3. All 7 files from upstream are present
4. Content digest is reproducible (same commit = same digest)
5. LICENSE.txt attribution is proper

## Potential Surprises to Watch For

1. **Upstream structure changes**: If Anthropic reorganizes their repo
2. **New dependencies**: If scripts require Python packages not in standard lib
3. **Large files**: If upstream adds binary assets (we'd need to decide whether to include)
4. **Symlinks**: If skill-creator uses symlinks (unlikely but would need handling)

If any of these occur during implementation, I'll pause and discuss before proceeding.

## Files Created


| File                                                     | Purpose                        |
| -------------------------------------------------------- | ------------------------------ |
| `internal/seedpack/tools/vendor_skill.sh`                | Automated vendoring script     |
| `internal/seedpack/skills/skill-creator/SKILL.md`        | Vendored skill instructions    |
| `internal/seedpack/skills/skill-creator/LICENSE.txt`     | Apache 2.0 license attribution |
| `internal/seedpack/skills/skill-creator/provenance.json` | Origin tracking                |
| `internal/seedpack/skills/skill-creator/scripts/*`       | Vendored Python scripts        |
| `internal/seedpack/skills/skill-creator/references/*`    | Vendored reference docs        |


## Not In Scope (Deferred to Later Phases)

- `manifest.json` (Phase 1.2)
- Go `embed` directive (Phase 1.3)
- skill-creator-agent.yaml (Phase 4.2)
- `stigmer seed update` command (Phase 6.1)

