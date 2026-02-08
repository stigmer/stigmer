# Vendored Anthropic skill-creator for Offline-First Bootstrap

**Date**: February 8, 2026

## Summary

Implemented Phase 1.1 of the CLI platform capabilities project: vendoring Anthropic's skill-creator skill into the Stigmer CLI with full provenance tracking and reproducible automation. This establishes the foundation for Stigmer's self-bootstrapping agent system, enabling offline-first operation and supply-chain security.

The vendored skill-creator will power the `stigmer draft` commands by providing AI agents with guidance on creating valid YAML configurations for agents, workflows, skills, and MCP servers.

## Problem Statement

Stigmer needs AI-powered `draft` commands that help users create valid YAML configurations:
- `stigmer draft agent` - Create agent YAML
- `stigmer draft workflow` - Create workflow YAML  
- `stigmer draft skill` - Create skill YAML
- `stigmer draft mcpserver` - Create MCP server YAML

These commands require the skill-creator skill (from Anthropic) to be available to AI agents. However, fetching skills from external repositories at runtime introduces several problems:

### Pain Points

- **Network dependency on startup**: Server can't start offline if it needs to clone external repos
- **Supply-chain risk**: Auto-cloning from GitHub HEAD exposes the system to upstream changes without review
- **Reproducibility issues**: Different installations get different content based on when they clone
- **Version drift**: No mechanism to track which version of skill-creator is being used
- **No provenance**: Can't audit where the skill came from or verify its integrity

These issues violate the design principles established in our seedpack bootstrap research:
- Offline-first operation (like K3s, Ollama)
- Pinned dependencies with checksums (like Terraform lockfiles)
- Explicit updates under user control (not auto-pull)

## Solution

Implemented a vendoring system that embeds Anthropic's skill-creator directly into the CLI repository with complete provenance tracking and reproducible automation.

### High-Level Approach

1. **Build-time vendoring**: Clone skill-creator during development, not at runtime
2. **Commit provenance**: Pin to specific git commit SHA with content digests
3. **Automated script**: Reproducible `vendor_skill.sh` for future updates
4. **Verification tests**: Ensure compatibility with existing Stigmer parsers

### Architecture

```
Build Time (this phase):
  vendor_skill.sh → Clone Anthropic repo → Copy skill-creator → Generate provenance

Runtime (future phases):
  Go embed → Load from binary → Bootstrap on server start → Available offline
```

## Implementation Details

### Directory Structure

Created the seedpack package in the CLI:

```
client-apps/cli/internal/seedpack/
├── BUILD.bazel                              # Bazel build configuration
├── seedpack_test.go                         # Verification tests
├── tools/
│   └── vendor_skill.sh                      # Automated vendoring script (312 lines)
└── skills/
    └── skill-creator/
        ├── SKILL.md                         # Skill instructions (357 lines)
        ├── LICENSE.txt                      # Apache 2.0 license (201 lines)
        ├── provenance.json                  # Origin tracking metadata
        ├── scripts/
        │   ├── init_skill.py                # Skill initialization (303 lines)
        │   ├── package_skill.py             # Skill packaging (110 lines)
        │   └── quick_validate.py            # Validation (102 lines)
        └── references/
            ├── output-patterns.md           # Output pattern guidance (82 lines)
            └── workflows.md                 # Workflow patterns (27 lines)
```

### vendor_skill.sh Script

Implemented a robust bash script that automates skill vendoring:

**Features**:
- Platform-agnostic SHA256 calculation (Linux/macOS)
- Shallow clone by default for speed
- Full clone support for specific commits
- Per-file digest calculation
- Combined content digest generation
- Provenance JSON generation with jq
- Clean error handling and logging

**Usage**:
```bash
# Vendor skill-creator at current HEAD
./vendor_skill.sh skill-creator

# Vendor at specific commit
./vendor_skill.sh skill-creator abc123def456789...
```

**Output**:
- Copies all skill files to seedpack
- Generates `provenance.json` with full tracking
- Reports vendored files and digests
- Shows diff when re-vendoring

### Provenance Tracking

Generated `provenance.json` schema:

```json
{
  "schema_version": "1",
  "source": {
    "type": "git",
    "url": "https://github.com/anthropics/skills",
    "ref": "main",
    "commit_sha": "1ed29a03dc852d30fa6ef2ca53a67dc2c2c2c563",
    "subdir": "skills/skill-creator"
  },
  "vendored_at": "2026-02-08T06:20:19Z",
  "vendored_by": "vendor_skill.sh",
  "content_digest": "sha256:c2cb6665d579f8eafaba1194ea4751599ab0236d8766f8ced5a89579208ff47b",
  "files": [
    {"path": "SKILL.md", "digest": "sha256:d57b6e3a445..."},
    {"path": "LICENSE.txt", "digest": "sha256:58d1e17ffe5..."},
    ...
  ]
}
```

**Provenance benefits**:
- **Reproducibility**: Same commit = same digest
- **Audit trail**: Know exactly where content came from
- **Verification**: Per-file digests enable targeted checks
- **Supply-chain security**: Can detect upstream tampering
- **Future updates**: Diff old vs new provenance

### Verification Tests

Created `seedpack_test.go` with comprehensive checks:

**Test cases**:
1. **SKILL.md parses correctly** - Uses existing `artifact.ParseSkillMetadata()` 
2. **LICENSE.txt is Apache 2.0** - Verifies license attribution
3. **provenance.json is valid** - Schema validation, required fields
4. **All expected files exist** - 8 files accounted for

**Platform support**:
- Works with `go test` (local development)
- Works with `bazel test` (CI/CD)
- Runfiles path resolution for Bazel sandbox

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Vendoring script vs manual | Reproducibility for Phase 6.1 `stigmer seed update` |
| Per-file digests in provenance | Enables targeted verification and diff detection |
| Shallow clone by default | Faster vendoring (6s vs 20s+), full history not needed |
| Schema version in provenance | Future-proofs format evolution |
| Global cleanup trap | Robust temp directory cleanup even on errors |
| Both test systems | Developers use `go test`, CI uses `bazel test` |

## Vendored Content

**From**: `https://github.com/anthropics/skills/tree/main/skills/skill-creator`  
**Commit**: `1ed29a03dc852d30fa6ef2ca53a67dc2c2c2c563`  
**Total**: ~50KB across 8 files

### What skill-creator Provides

Anthropic's skill-creator is a comprehensive guide for creating effective AI skills:

**Core capabilities**:
- Skill structure patterns (SKILL.md format, bundled resources)
- Progressive disclosure design (metadata always loaded, instructions on demand)
- Workflow patterns for multi-step processes
- Output pattern guidance (templates, examples)
- Validation and packaging scripts

**Key principles** (from SKILL.md):
- Concise is key - context window is shared
- Set appropriate degrees of freedom (high/medium/low)
- Anatomy: SKILL.md + optional scripts/references/assets
- Progressive disclosure: metadata → instructions → resources

This guidance will be consumed by AI agents powering `stigmer draft` commands to help users create well-structured YAML configurations.

## Benefits

### Immediate Benefits

1. **Offline-first operation**
   - CLI can be built and distributed without network access
   - Future: Server can bootstrap without network dependency
   - Developers can work offline after initial checkout

2. **Supply-chain security**
   - Pinned to specific commit (not HEAD)
   - Per-file digests detect tampering
   - Provenance provides audit trail
   - Changes are reviewed via pull requests

3. **Reproducibility**
   - Same commit → same content → same digest
   - Build determinism for releases
   - Debugging: know exactly which version is running

4. **Developer experience**
   - Automated vendoring script (not manual copy-paste)
   - Verification tests catch incompatibilities early
   - Clear provenance for debugging

### Future Benefits (Subsequent Phases)

5. **Explicit update control** (Phase 6.1)
   - `stigmer seed update` to sync with upstream
   - Diff preview before accepting changes
   - User confirms updates (not auto-pull)

6. **Embedded in binary** (Phase 1.3)
   - Go `embed` directive loads from binary
   - No disk I/O needed at runtime
   - Smaller deployment footprint

7. **Bootstrap automation** (Phase 2.x)
   - Server applies seedpack on first start
   - System resources available immediately
   - Durable state machine tracks progress

## Impact

### What's Affected

**Developers**:
- Can update vendored skills via `vendor_skill.sh`
- Tests verify compatibility after updates
- Clear provenance aids debugging

**Users** (future phases):
- Will benefit from offline-first operation
- Supply-chain security without manual work
- Explicit update control via CLI commands

**CI/CD**:
- Deterministic builds (pinned content)
- Bazel test integration verifies vendored content
- No external network calls during build

### Integration Points (Future Phases)

This work sets the stage for:

1. **Phase 1.2**: `manifest.json` creation
   - Indexes vendored skills and agents
   - Version tracking for seedpack
   - Enables programmatic discovery

2. **Phase 1.3**: Go embed infrastructure
   - `//go:embed` directive in `embed.go`
   - `LoadManifest()` and `LoadSkillContent()` functions
   - Runtime access to vendored content

3. **Phase 2.x**: Server bootstrap
   - Apply seedpack to registry on startup
   - Create system skills and agents
   - State machine for resumable bootstrap

4. **Phase 5.x**: Draft commands
   - `stigmer draft agent` powered by skill-creator
   - AI agents use embedded skill guidance
   - Users get AI-assisted YAML authoring

## Related Work

### Research Foundation

This implementation follows the architecture validated in:
- `research.seedpack-bootstrap-architecture/04.report.gpt.md`
  - Compared against K3s, Codex, Terraform, Ollama patterns
  - Established "no git clone on startup" principle
  - Defined provenance tracking requirements

### Project Context

Part of broader CLI platform capabilities initiative:
- **Project**: `_projects/2026-02/20260207.03.cli-platform-capabilities/`
- **Plan**: `tasks/T01_2_practical_plan.md` (12 phases total)
- **Goal**: Enable self-bootstrapping agent & skill system

### Upstream Attribution

- **Source**: Anthropic's public skills repository
- **License**: Apache License 2.0 (included as LICENSE.txt)
- **Documentation**: See vendored SKILL.md for full skill-creator guidance

## Technical Notes

### Compatibility

- **SKILL.md format**: Compatible with existing `artifact.ParseSkillMetadata()`
- **Test systems**: Both `go test` and `bazel test` pass
- **Platforms**: Linux and macOS (Darwin)

### File Sizes

- **SKILL.md**: 357 lines (~18KB) - Main skill instructions
- **Python scripts**: 515 lines total - init, package, validate
- **References**: 109 lines total - output patterns, workflows
- **Total vendored**: ~50KB of content

### Future Considerations

**Phase 6.1 `stigmer seed update` command will need**:
- Fetch upstream changes
- Compare provenance (commit, digest)
- Show diff for review
- User confirmation
- Re-run vendor_skill.sh
- Update registry if server running

**Potential extensions**:
- Signature verification (cosign)
- Multi-skill vendoring support
- Vendoring from non-Anthropic sources
- Conflict resolution for duplicate skills

---

**Status**: ✅ Complete (Phase 1.1)  
**Timeline**: Single development session (~2 hours)  
**Next Phase**: 1.2 - Create seedpack manifest.json  
**Files Created**: 12 files (~1300 lines total)  
**Tests**: 4 test cases, all passing

---

This foundation enables Stigmer to bootstrap itself with trusted system skills while maintaining offline-first operation, supply-chain security, and explicit update control. The vendored skill-creator will power future AI-assisted YAML authoring commands, making Stigmer easier to use and configure.
