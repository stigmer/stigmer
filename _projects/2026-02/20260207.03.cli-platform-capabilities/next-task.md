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
**Updated**: 2026-02-13 (Session 4 - Draft Skill Implemented)
**Current Task**: Phase 5.1 Complete - Ready for Phase 5.2 or 6.x
**Status**: Phases 1.1-2.2, 5.1 Complete ✅ | Phases 3.1, 4.1 Deferred 🚫

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

## Session Progress (2026-02-13 Session 4) - CURRENT

**Phase 5.1: Draft Skill Command - COMPLETED**

**Implementation**:
- ✅ Created `draft.go` - Command group with extensible structure
- ✅ Created `draft_skill.go` - Subcommand with flags (--attach, --output, --follow)
- ✅ Created `draft_skill_handler.go` - Handler delegating to existing infrastructure
- ✅ Wired `NewDraftCommand()` in root.go
- ✅ Build verified - no errors, help text correct

**Key Design**:
- Thin wrapper pattern - reuses 100% of existing artifact lifecycle infrastructure
- Resolves `local/skill-creator-agent` (matches bootstrap org)
- Always waits for completion and downloads artifacts
- Zero code duplication - delegates to `runAgent()`, `AttachmentProcessor`, `downloadArtifacts()`

**Bug Fix**:
- Fixed `skill-creator-agent.yaml` skill_refs: changed org from `stigmer` to `local`

**Files Created**:
- `client-apps/cli/cmd/stigmer/root/draft.go` (35 lines)
- `client-apps/cli/cmd/stigmer/root/draft_skill.go` (80 lines)
- `client-apps/cli/cmd/stigmer/root/draft_skill_handler.go` (110 lines)
- `_changelog/2026-02/2026-02-13-153224-draft-skill-command.md`

**Files Modified**:
- `backend/libs/go/seedpack/agents/skill-creator-agent.yaml` (org fix)
- `client-apps/cli/cmd/stigmer/root.go` (wired draft command)

**Commit**: `ae2ed04d` - feat(cli): add draft skill command with artifact lifecycle integration

---

### Session Progress (2026-02-08 Session 3)

**Phase 2.1: Bootstrap State Machine - COMPLETED**

**Key Design Decision: Pre-built Artifacts**
After user challenge on SDK usage, revised approach to:
- Pre-build ZIP artifacts at vendor time (not runtime)
- Store agents as YAML, parse at runtime with CLI's proven pattern
- Directly call existing gRPC APIs (Push for skills, Apply for agents)

**SQLite Schema v4: bootstrap_state table**
- ✅ Added `bootstrap_state` key-value table for tracking progress
- ✅ Methods: `GetBootstrapState()`, `SetBootstrapState()`, `GetAllBootstrapState()`, `DeleteBootstrapState()`, `ClearBootstrapState()`
- ✅ Tests pass: 10 new bootstrap state tests

**Seedpack Updates (Schema v2)**:
- ✅ Updated `manifest.json` with `artifact_path`, `artifact_digest` for skills
- ✅ Created `agents/skill-creator-agent.yaml` (system agent definition)
- ✅ Created `artifacts/skill-creator.zip` (pre-built ZIP)
- ✅ Updated `vendor_skill.sh` to create pre-built ZIPs
- ✅ Added `LoadSkillArtifact()` and `LoadAgentYAML()` functions
- ✅ Tests pass: 7 updated + 2 new seedpack tests

**Bootstrap Module** (`backend/services/stigmer-server/pkg/bootstrap/`):
- ✅ Created `bootstrap.go` with `Bootstrapper` struct and `Run()` method
- ✅ Loads seedpack manifest, checks version
- ✅ Pushes skills via gRPC Push API (idempotent)
- ✅ Applies agents via gRPC Apply API (idempotent)
- ✅ Tracks per-resource state with content digests
- ✅ Graceful degradation on failure (server continues)
- ✅ Tests pass: 7 comprehensive tests

**Phase 2.2: Server Integration - COMPLETED**
- ✅ Added `Apply()` method to agent downstream client
- ✅ Integrated bootstrap into `server.go` after in-process clients ready
- ✅ Updated `BUILD.bazel` with bootstrap dependency
- ✅ All builds pass with `go build`

**Files Created/Modified**:
```
backend/libs/go/seedpack/
├── manifest.json                    # Updated to schema v2
├── embed.go                         # Added artifacts/* and agents/*
├── seedpack.go                      # Added LoadSkillArtifact, LoadAgentYAML
├── seedpack_test.go                 # Updated + new tests
├── agents/skill-creator-agent.yaml  # NEW: System agent definition
├── artifacts/skill-creator.zip      # NEW: Pre-built artifact
└── tools/vendor_skill.sh            # Updated: creates ZIP artifacts

backend/libs/go/store/sqlite/
├── store.go                         # Schema v4: bootstrap_state table + methods
└── store_test.go                    # 10 new bootstrap state tests

backend/services/stigmer-server/pkg/bootstrap/  # NEW PACKAGE
├── bootstrap.go                     # Core bootstrapper (~340 lines)
├── bootstrap_test.go                # Comprehensive tests (~220 lines)
└── BUILD.bazel                      # Bazel configuration

backend/services/stigmer-server/pkg/downstream/agent/
└── client.go                        # Added Apply() method

backend/services/stigmer-server/pkg/server/
├── BUILD.bazel                      # Added bootstrap dependency
└── server.go                        # Integrated bootstrap call
```

**All Tests Pass**:
- ✅ `backend/libs/go/seedpack/...` - 15 tests
- ✅ `backend/libs/go/store/sqlite/...` - 37 tests
- ✅ `backend/services/stigmer-server/pkg/bootstrap/...` - 7 tests

## Next Steps (for Next Session)

**Phase 5.1 Complete!** The `stigmer draft skill` command is implemented and working.

**Recommended Next Tasks:**

**Option A: Phase 5.2 - Other Draft Commands**
- Implement `stigmer draft agent` (requires agent-drafter-agent)
- Implement `stigmer draft workflow` (requires workflow-drafter-agent)
- Implement `stigmer draft mcpserver` (requires mcpserver-drafter-agent)

Each requires:
1. Using `stigmer draft skill` to create a drafter skill for that resource type
2. Creating a drafter agent that uses the skill (can use skill-creator-agent)
3. Adding CLI command wiring (same pattern as draft skill)

**Option B: Phase 6.1 - Seed Update Command**
- Implement `stigmer seed update` for upstream sync
- Enable updating vendored skills from Anthropic repo
- Requires network connectivity

**Option C: Phase 6.2 - System Commands**
- Implement `stigmer system list` - show all system resources
- Implement `stigmer system status` - show bootstrap state
- Implement `stigmer system disable/enable` - control system resources

**Recommended**: Start with Option A (draft agent) or test the draft skill command end-to-end first.

## Quick Commands

After loading context:
- "Start Phase 5.1" - Implement `stigmer draft agent` command
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

## Implementation Order (from T01_2 Practical Plan)

| Order | Phase | Task | Description | Status |
|-------|-------|------|-------------|--------|
| 1 | 1.1 | Vendor skill-creator | Pin to commit SHA, record provenance | ✅ Complete |
| 2 | 1.2 | Seedpack structure | Directory and manifest setup | ✅ Complete |
| 3 | 1.3 | Go embed infrastructure | Load skills from binary | ✅ Complete |
| 4 | 2.1 | Bootstrap state machine | Durable bootstrap logic | ✅ Complete |
| 5 | 2.2 | Server integration | Hook bootstrap to server start | ✅ Complete |
| ~~6~~ | ~~3.1~~ | ~~Skill resolver~~ | ~~Resolve from registry or embedded~~ | 🚫 Deferred |
| ~~7~~ | ~~4.1~~ | ~~Agent runtime integration~~ | ~~Wire skills into agent invocation~~ | 🚫 Deferred |
| ~~8~~ | ~~4.2~~ | ~~skill-creator-agent~~ | ~~The agent that creates skills~~ | ✅ Created via bootstrap |
| **6** | **5.1** | **`draft skill` command** | **User-facing feature** | ✅ **Complete** |
| **→ 7** | **5.2** | **Other draft commands** | **workflow, agent, mcpserver** | 🎯 Next |
| 8 | 6.1 | Seed update command | Explicit upstream sync | Pending |
| 9 | 6.2 | System commands | list, status, disable, enable | Pending |

## Key Design Decisions (from Research)

| Decision | Rationale |
|----------|-----------|
| Vendor content, no git clone on startup | Offline-first, supply-chain security (K3s, Ollama) |
| Track provenance (url, commit, digest) | Reproducibility, audit trail (Terraform lockfile) |
| Bootstrap as state machine | Resumable, debuggable (K3s AddOn status) |
| Explicit update command | User controls network usage (Terraform `-upgrade`) |
| System scope with disable | Override without mutation (Codex system skills) |
| **Defer skill resolver (Phase 3.1)** | Skills are in registry via bootstrap; embedded fallback not needed now |
| **Defer agent runtime integration (Phase 4.1)** | Agents invoke skills from registry using existing patterns |

---

*This file provides direct paths to all project resources for quick context loading.*
