# Next Task: 20260207.03.cli-platform-capabilities

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: CLI Platform Capabilities (Draft Commands)

**Description**: Implement self-bootstrapping agent & skill system with vendored seedpack for offline-first operation. Enable AI-powered draft commands using embedded Anthropic skill-creator.

**Goal**: Enable `stigmer draft agent|workflow|skill|mcpserver` commands with embedded platform capabilities that power AI-assisted YAML authoring. Implement `stigmer system` and `stigmer seed` command groups for managing system resources.

**Tech Stack**: Go (CLI), go:embed, YAML, Temporal

**Components**: 
- CLI commands: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli`
- Seedpack bundle: `internal/seedpack/` (new)
- Server bootstrap: `backend/services/stigmer-server/pkg/server/bootstrap.go` (new)

---

## Research Summary (Three Research Reports)

**Research Reports**:
1. `research.platform-capabilities-draft-implementation/04.report.gpt.md` (Original)
2. `research.skill-format-integration-strategy/04.report.gpt.md` (Self-Bootstrapping)
3. `research.seedpack-bootstrap-architecture/04.report.gpt.md` (Architecture Validation) **← LATEST**

### Key Findings (From Seedpack Bootstrap Research)

**Architecture Validated Against**:
- K3s packaged components (bundled content, applied on startup)
- OpenAI Codex (SYSTEM skill-creator)
- Terraform (lockfile with checksums)
- Ollama (server starts without network)

**Critical Design Decision**:
> **"Do not auto-clone upstream repos during server startup."**

**Revised Architecture: Vendored Seedpack**
1. **Vendor skill content** in binary (pinned to commit SHA)
2. **No network** required for server startup
3. **Explicit updates** via `stigmer seed update`
4. **Provenance tracking** (git url, commit, digest)
5. **Bootstrap as state machine** (resumable, debuggable)

### Bootstrapping Flow (Revised)
```
Build Time: Vendor Anthropic skill-creator → Embed in CLI binary
                                                    ↓
Runtime: stigmer server starts → Bootstrap (offline, embedded content)
                                                    ↓
                                      skill-creator + skill-creator-agent created
                                                    ↓
User: stigmer run agent skill-creator-agent → Creates yaml-validator
                                                    ↓
User: Creates drafter skills → Creates drafter agents
                                                    ↓
                                      stigmer draft <resource> works
```

### Target Command Structure (Revised)
```
stigmer system
├── list       # List all system resources
├── status     # Show bootstrap state
├── disable    # Disable system skill without removing
└── enable     # Re-enable system skill

stigmer seed
├── update     # Explicit upstream sync (requires network)
└── status     # Show seedpack version

stigmer draft agent      # AI-assisted agent YAML creation
stigmer draft workflow   # AI-assisted workflow YAML creation
stigmer draft skill      # AI-assisted skill YAML creation
stigmer draft mcpserver  # AI-assisted MCP server YAML creation
```

---

## Essential Files to Review

### 1. Current Plan (CRITICAL - START HERE)
Read the practical plan with research findings incorporated:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/tasks/T01_2_practical_plan.md
```

### 2. Deep Research Reports
Seedpack bootstrap architecture (latest):
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/research.seedpack-bootstrap-architecture/04.report.gpt.md
```

Self-bootstrapping architecture:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/research.skill-format-integration-strategy/04.report.gpt.md
```

Original platform capabilities:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/research.platform-capabilities-draft-implementation/04.report.gpt.md
```

### 3. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/checkpoints/
```

### 4. All Tasks
Review all task files:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/tasks/
```

### 5. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-07 13:36
**Updated**: 2026-02-08 (Session 2)
**Current Task**: T01 Phase 2.1 (Bootstrap state machine)
**Status**: Phase 1.1, 1.2, 1.3 Complete ✅

**Active Plan**: `tasks/T01_2_practical_plan.md` (research-informed, APPROVED)

### Session Progress (2026-02-08 Session 1)

**Phase 1.1: Vendor skill-creator - COMPLETED**
- ✅ Created `internal/seedpack/` directory structure
- ✅ Implemented `vendor_skill.sh` with full automation
- ✅ Vendored skill-creator from Anthropic (commit: `1ed29a03dc85`)
- ✅ Generated provenance.json with digests
- ✅ Added BUILD.bazel and verification tests
- ✅ Tests pass with both `go test` and `bazel test`

### Session Progress (2026-02-08 Session 2)

**Phase 1.2-1.3: Seedpack Infrastructure - COMPLETED**

**Key Decision: SDK Approach**
- Chose programmatic agent creation over static YAML files
- `skill-creator-agent` will be created in bootstrap.go using proto structs
- Follows existing Stigmer patterns and provides compile-time safety

**Relocation**:
- ✅ Moved seedpack from `cli/internal/seedpack/` to `backend/libs/go/seedpack/`
- Enables both CLI and server to import the package
- Follows established pattern (CLI already imports from `backend/libs/go/`)

**Files Created**:
```
backend/libs/go/seedpack/
├── manifest.json                            # Seedpack metadata
├── embed.go                                 # Go embed directives
├── seedpack.go                              # Loader functions (340 lines)
├── seedpack_test.go                         # Comprehensive tests (450 lines)
├── BUILD.bazel                              # Bazel configuration
├── skills/skill-creator/                    # Vendored content (moved)
└── tools/vendor_skill.sh                    # Vendoring script (moved)
```

**API Surface**:
- `LoadManifest()` - Parse manifest.json
- `LoadSkillContent()` - Load SKILL.md content
- `LoadSkillMetadata()` - Parse YAML frontmatter
- `LoadSkillProvenance()` - Load provenance.json
- `ListSkillFiles()` - List all skill files
- `LoadSkillFile()` - Load individual skill files
- `GetSkillByName()` - Lookup skill by name
- `GetAgentByName()` - Lookup system agent by name

**Test Results**:
- ✅ All 14 tests pass with `go test`
- ✅ All tests pass with `bazel test`
- ✅ Content digest verification passes (7 files verified)
- ✅ No linter errors

**Key Achievements**:
- Inline SKILL.md parsing (no external dependency duplication)
- Proper embed support in Bazel with `embedsrcs`
- Comprehensive error handling and validation
- Ready for Phase 2 bootstrap integration

## Next Steps (for Next Session)

1. **Start Phase 2.1**: Implement Bootstrap State Machine
   - Create `backend/services/stigmer-server/pkg/server/bootstrap.go`
   - Define BootstrapStep enum and BootstrapState struct
   - Implement step-level durability with SQLite persistence
   - Add `bootstrap_state` table to schema

2. **Then Phase 2.2**: Server Integration
   - Hook bootstrap into `server.Run()` after store initialization
   - Ensure bootstrap doesn't block startup on failure
   - Use embedded seedpack content (no network required)

## Quick Commands

After loading context:
- "Start Phase 1.2" - Create manifest.json
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

## Implementation Order (from T01_2 Practical Plan)

| Order | Phase | Task | Description |
|-------|-------|------|-------------|
| 1 | 1.1 | Vendor skill-creator | Pin to commit SHA, record provenance |
| 2 | 1.2 | Seedpack structure | Directory and manifest setup |
| 3 | 1.3 | Go embed infrastructure | Load skills from binary |
| 4 | 2.1 | Bootstrap state machine | Durable bootstrap logic |
| 5 | 2.2 | Server integration | Hook bootstrap to server start |
| 6 | 3.1 | Skill resolver | Resolve from registry or embedded |
| 7 | 4.1 | Agent runtime integration | Wire skills into agent invocation |
| 8 | 4.2 | skill-creator-agent | The agent that creates skills |
| 9 | 5.1 | `draft agent` command | User-facing feature |
| 10 | 5.2 | Other draft commands | workflow, skill, mcpserver |
| 11 | 6.1 | Seed update command | Explicit upstream sync |
| 12 | 6.2 | System commands | list, status, disable, enable |

## Key Design Decisions (from Research)

| Decision | Rationale |
|----------|-----------|
| Vendor content, no git clone on startup | Offline-first, supply-chain security (K3s, Ollama) |
| Track provenance (url, commit, digest) | Reproducibility, audit trail (Terraform lockfile) |
| Bootstrap as state machine | Resumable, debuggable (K3s AddOn status) |
| Explicit update command | User controls network usage (Terraform `-upgrade`) |
| System scope with disable | Override without mutation (Codex system skills) |

---

*This file provides direct paths to all project resources for quick context loading.*
