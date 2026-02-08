---
name: Phase 1.2-1.3 Seedpack Infrastructure
overview: Relocate seedpack to shared location, create manifest.json, and implement Go embed infrastructure with loader functions. Uses SDK approach - agent configuration is code, not YAML.
todos:
  - id: relocate-seedpack
    content: Move seedpack from cli/internal/seedpack/ to backend/libs/go/seedpack/
    status: completed
  - id: create-manifest
    content: Create manifest.json with schema, version, skills, and system_agents metadata
    status: completed
  - id: create-embed
    content: Create embed.go with //go:embed directives for manifest.json and skills/*
    status: completed
  - id: implement-loaders
    content: Implement seedpack.go with LoadManifest, LoadSkillContent, LoadSkillMetadata, LoadSkillFiles functions
    status: completed
  - id: extract-skillmd-parser
    content: Extract SKILL.md parsing logic to shared location (optional - can inline if preferred)
    status: completed
  - id: update-bazel
    content: Update BUILD.bazel for new location with proper embed support
    status: completed
  - id: write-tests
    content: Write comprehensive unit tests for all loader functions
    status: completed
  - id: verify-digests
    content: Verify vendored content digests still match provenance.json after move
    status: completed
isProject: false
---

# Phase 1.2-1.3: Seedpack Infrastructure (SDK Approach)

## Architecture Decision

Move seedpack from `client-apps/cli/internal/seedpack/` to `backend/libs/go/seedpack/` so both CLI and server can import it. The CLI already imports from `backend/libs/go/` (established pattern).

**Key insight from SDK approach**: The `skill-creator-agent` will NOT be a static YAML file. Instead, it will be created programmatically in Phase 2's bootstrap.go using proto structs directly, following the existing pattern in [dependency_discoverer_test.go](backend/services/stigmer-server/pkg/domain/project/reconcile/dependency_discoverer_test.go):

```go
// Phase 2 will create agent like this (NOT in Phase 1.2-1.3)
agent := &agentv1.Agent{
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "skill-creator-agent",
        Org:  "stigmer",
    },
    Spec: &agentv1.AgentSpec{
        Description:  "Creates new skills using the SKILL.md format",
        Instructions: "...",
        SkillRefs:    []*apiresource.ApiResourceReference{{Org: "stigmer", Slug: "skill-creator"}},
    },
}
```

## Phase 1.2: Seedpack Structure & Manifest

### 1. Relocate Seedpack to Shared Location

Move from `client-apps/cli/internal/seedpack/` to `backend/libs/go/seedpack/`:

```
backend/libs/go/seedpack/
├── BUILD.bazel
├── embed.go                    # Go embed directive (Phase 1.3)
├── manifest.json               # Seedpack metadata (this phase)
├── seedpack.go                 # Loader functions (Phase 1.3)
├── seedpack_test.go            # Existing tests (moved)
├── skills/
│   └── skill-creator/          # Existing vendored content (moved)
│       ├── LICENSE.txt
│       ├── provenance.json
│       ├── SKILL.md
│       ├── references/
│       └── scripts/
└── tools/
    └── vendor_skill.sh         # Vendoring script (moved)
```

### 2. Create manifest.json

```json
{
  "schema_version": "1",
  "version": "1.0.0",
  "created_at": "2026-02-08T00:00:00Z",
  "description": "Stigmer system seedpack - bootstrap resources for offline operation",
  "skills": [
    {
      "name": "skill-creator",
      "path": "skills/skill-creator",
      "content_digest": "sha256:c2cb6665d579f8eafaba1194ea4751599ab0236d8766f8ced5a89579208ff47b",
      "source": {
        "type": "git",
        "url": "https://github.com/anthropics/skills",
        "commit_sha": "1ed29a03dc852d30fa6ef2ca53a67dc2c2c2c563"
      }
    }
  ],
  "system_agents": [
    {
      "name": "skill-creator-agent",
      "description": "Creates new skills using the SKILL.md format",
      "skill_refs": ["skill-creator"]
    }
  ]
}
```

**Design notes:**

- `system_agents` is metadata only - actual agent creation happens in bootstrap.go (Phase 2)
- `content_digest` pulled from existing [provenance.json](client-apps/cli/internal/seedpack/skills/skill-creator/provenance.json)
- Schema version allows future manifest format evolution

### 3. Validate SKILL.md Compatibility

Use existing [ParseSkillMetadata](client-apps/cli/internal/cli/artifact/skillmd.go) logic to validate:

- The vendored skill-creator SKILL.md parses correctly
- Name matches kebab-case pattern
- Required fields (name, description) present

---

## Phase 1.3: Go Embed Infrastructure

### 1. Create embed.go

```go
// backend/libs/go/seedpack/embed.go
package seedpack

import "embed"

//go:embed manifest.json
//go:embed skills/*
var content embed.FS
```

**Note**: We embed only `manifest.json` and `skills/*`. The `tools/` directory (vendor_skill.sh) is NOT embedded - it's a build-time tool, not runtime content.

### 2. Implement Loader Types and Functions

```go
// backend/libs/go/seedpack/seedpack.go
package seedpack

// Manifest represents the seedpack metadata
type Manifest struct {
    SchemaVersion string        `json:"schema_version"`
    Version       string        `json:"version"`
    CreatedAt     string        `json:"created_at"`
    Description   string        `json:"description"`
    Skills        []SkillEntry  `json:"skills"`
    SystemAgents  []AgentEntry  `json:"system_agents"`
}

type SkillEntry struct {
    Name          string       `json:"name"`
    Path          string       `json:"path"`
    ContentDigest string       `json:"content_digest"`
    Source        SkillSource  `json:"source"`
}

type SkillSource struct {
    Type      string `json:"type"`
    URL       string `json:"url,omitempty"`
    CommitSHA string `json:"commit_sha,omitempty"`
}

type AgentEntry struct {
    Name        string   `json:"name"`
    Description string   `json:"description"`
    SkillRefs   []string `json:"skill_refs"`
}

// LoadManifest reads the embedded manifest
func LoadManifest() (*Manifest, error)

// LoadSkillContent loads a skill's full SKILL.md content
func LoadSkillContent(skillPath string) (string, error)

// LoadSkillMetadata parses SKILL.md frontmatter (reuses artifact.parseSkillMdContent logic)
func LoadSkillMetadata(skillPath string) (*SkillMetadata, error)

// ListSkillFiles returns all files in a skill directory
func ListSkillFiles(skillPath string) ([]string, error)

// LoadSkillFile reads a specific file from a skill
func LoadSkillFile(skillPath, filePath string) ([]byte, error)
```

### 3. Reuse Existing Parsing Logic

The [skillmd.go](client-apps/cli/internal/cli/artifact/skillmd.go) has `parseSkillMdContent()` that parses frontmatter. Two options:

**Option A (Recommended)**: Extract parsing logic to `backend/libs/go/skillmd/` and have both CLI and seedpack import it.

**Option B**: Duplicate the parsing logic in seedpack (simpler but creates duplication).

I recommend Option A - create a small shared package for SKILL.md parsing.

### 4. Unit Tests

Test coverage for:

- `LoadManifest()` returns valid manifest
- `LoadSkillContent("skills/skill-creator")` returns SKILL.md content
- `LoadSkillMetadata()` parses frontmatter correctly
- `LoadSkillFile()` retrieves scripts and references
- Content digest verification (optional but valuable)

---

## Files to Create/Move


| Action | From                                     | To                                  |
| ------ | ---------------------------------------- | ----------------------------------- |
| Move   | `cli/internal/seedpack/skills/`          | `libs/go/seedpack/skills/`          |
| Move   | `cli/internal/seedpack/tools/`           | `libs/go/seedpack/tools/`           |
| Move   | `cli/internal/seedpack/seedpack_test.go` | `libs/go/seedpack/seedpack_test.go` |
| Move   | `cli/internal/seedpack/BUILD.bazel`      | `libs/go/seedpack/BUILD.bazel`      |
| Create | -                                        | `libs/go/seedpack/manifest.json`    |
| Create | -                                        | `libs/go/seedpack/embed.go`         |
| Create | -                                        | `libs/go/seedpack/seedpack.go`      |
| Delete | `cli/internal/seedpack/`                 | (empty after move)                  |


---

## Key Implementation Notes

1. **No YAML agent file**: The `skill-creator-agent` is NOT stored as YAML. It's metadata in manifest.json, created programmatically in Phase 2.
2. **Bazel compatibility**: Update BUILD.bazel with `go_embed_data` or ensure `go_library` includes embed files.
3. **Import path update**: Any existing imports of `cli/internal/seedpack` need updating to `backend/libs/go/seedpack`.
4. **Provenance preserved**: The existing `provenance.json` files stay with their skills - they contain per-skill tracking.

---

## Success Criteria

- `go test ./backend/libs/go/seedpack/...` passes
- `bazel test //backend/libs/go/seedpack:all` passes
- `LoadManifest()` returns parsed manifest with skill-creator entry
- `LoadSkillContent("skills/skill-creator")` returns full SKILL.md
- `LoadSkillMetadata("skills/skill-creator")` returns `{Name: "skill-creator", Description: "..."}`
- Vendored content unchanged (digests still match provenance.json)

---

## What This Does NOT Include (Deferred to Phase 2)

- Bootstrap state machine (Phase 2.1)
- Server integration (Phase 2.2)
- Actual Skill/Agent resource creation in registry
- CLI command updates for draft

This phase establishes the foundation - the embedded content and loaders that Phase 2 will use.