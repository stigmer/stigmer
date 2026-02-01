# Next Task: 20260131.02.cli-agent-yaml-first

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: CLI Agent YAML-First

**Description**: Restructure CLI to make Agent a YAML-first resource, remove Agent from SDK (keeping only Workflow), and add agentic creation commands where users describe what they want and agents create the resources.

**Goal**: Enable agent-assisted resource creation - users describe what they want (an agent, skill, workflow) and our platform creates it agentically. Simplify Agent to YAML-based configuration, keep only Workflow in SDK for complex orchestration.

**Tech Stack**: Go (CLI), Proto definitions, gRPC APIs

**Components**: 
- CLI commands: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli`
- Go SDK: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go`
- Backend APIs: `/Users/suresh/scm/github.com/stigmer/stigmer-cloud`

---

## Current Status

**Phase**: Phase 1 - Agent YAML-First Foundation (IN PROGRESS)
**Current Task**: Sub-task 6 - List + Delete Commands
**Status**: Sub-tasks 1-5 COMPLETED ✅ (5 of 7, 71% complete)

**Latest Session** (2026-02-01 - Session 5):
- ✅ Completed Sub-task 5: Validate + Get Commands
- ✅ **Major architectural improvement**: Refactored pkg/reference to use enum-based ID detection
  - Eliminated ALL hardcoded ID prefix strings (agt_, mcp-, etc.)
  - Made ApiResourceKind enum single source of truth
  - Zero maintenance for new resource kinds
- Created agent_validate.go (78 lines) - CI-friendly validation
- Created agent_get.go (115 lines) - flexible retrieval (table/yaml/json)
- Created get.go (84 lines) - gRPC fetch logic
- Extended display.go (+77 lines) - get output formatting
- Refactored reference.go (241 lines) - enum-driven ID detection
- Updated reference_test.go with enum-derived prefixes
- All tests passing (reference: 28 tests, agent: all tests)
- Changelog: `2026-02-01-094716-agent-validate-get-commands-enum-id-detection.md`
- Committed: PENDING

**Previous Session** (2026-02-01 - Session 4):
- ✅ Completed Sub-task 4: Agent Apply Command
- Created agent.go (240 lines) command group with apply subcommand
- Registered NewAgentCommand() in root.go
- Updated BUILD.bazel with agent.go source
- 8-step orchestration: load → validate → apply → display
- Mirrors MCP Server pattern for consistency
- All agent tests pass (28 total tests)
- Changelog: `2026-02-01-092828-agent-apply-command-foundation.md`
- Committed: `3757f63 feat(cli/agent): add agent apply command with orchestration`

**Previous Session** (2026-02-01 - Session 3):
- ✅ Completed Sub-task 3: Agent Applier & Display
- Created applier.go (89 lines) for gRPC apply orchestration
- Created display.go (85 lines) for terminal output formatting
- Updated BUILD.bazel with cliprint, apiresource, and grpc dependencies

**Previous Session** (2026-02-01 - Session 2):
- ✅ Completed Sub-task 2: Agent Schema Validator
- Enhanced proto validation (ApiResourceReference slug/org format rules)
- Implemented validator.go with cross-field validation (80 lines)
- Created comprehensive test suite (14 test functions, 28 total tests passing)
- Proto validation is single source of truth - Go only handles cross-field logic

**Session 1** (2026-02-01):
- ✅ Completed Sub-task 1: Agent YAML Loader
- Implemented loader.go with protovalidate as single source of truth
- Created comprehensive test suite (12 test cases, all passing)

**Key Achievement**: Strengthened proto validation at the source, minimal Go validation for cross-field business logic only

---

## Key Design Decisions

**1. Agent becomes YAML-first** (like MCP Server):
- Agent is declarative configuration, not orchestration
- SDK remains for Workflow only (requires implicit dependency tracking)

**2. `draft` for agent-assisted authoring**:
- Replaces `create` (CRUD-speak) with domain-accurate term
- Conveys collaborative, iterative nature

**3. Platform Capabilities embedded in CLI**:
- Drafting capabilities are platform functions, not user skills
- Embedded via `go:embed` (~100KB, works offline)
- Not visible in `stigmer skill list`

**4. Search + Discover separation**:
- Per-resource `search` for typed queries
- Root `discover` for cross-cutting exploration

See: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/design-decisions/001-agent-yaml-first-architecture.md`

---

## Target CLI Structure

```
stigmer
├── skill
│   ├── push, get, list, delete
│   ├── search <query>            # Search skills
│   └── draft                     # Agent-assisted authoring
├── mcpserver
│   ├── apply, get, list, delete
│   ├── search <query>            # Search MCP servers
│   └── draft                     # Agent-assisted authoring
├── agent                         # NEW resource commands
│   ├── apply <file>              # YAML-based (like mcpserver)
│   ├── get, list, delete
│   ├── search <query>            # Search agents
│   ├── run <slug>                # Execute agent
│   └── draft                     # Agent-assisted authoring
├── workflow
│   ├── apply                     # SDK synthesis (renamed from root)
│   ├── get, list, delete
│   ├── search <query>            # Search workflows
│   ├── run <slug>                # Execute workflow
│   └── draft                     # Agent-assisted authoring
└── discover <query>              # Cross-cutting discovery
```

**Removed**: Root `apply`, `run`, `new` commands

---

## Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **1** | Agent YAML-First Foundation | **IN PROGRESS** (Sub-tasks 1-3 of 7 complete) |
| **2** | Workflow Command Restructuring | Pending |
| **3** | Search and Discovery | Pending |
| **4** | Remove Agent from SDK | Pending |
| **5** | Platform Capabilities (Draft Commands) | Pending |
| **6** | Cleanup and Documentation | Pending |

### Phase 1 Progress

**Sub-tasks** (from `/Users/suresh/.cursor/plans/phase_1_agent_yaml-first_8df4f33f.plan.md`):

| Sub-task | Description | Duration | Status |
|----------|-------------|----------|--------|
| 1 | Agent YAML Loader | 60-75 min | ✅ **COMPLETED** |
| 2 | Agent Schema Validator | 45-60 min | ✅ **COMPLETED** |
| 3 | Agent Applier & Display | 60-75 min | ✅ **COMPLETED** |
| 4 | Agent Apply Command | 45-60 min | ✅ **COMPLETED** |
| 5 | Validate + Get Commands | 60-75 min | ✅ **COMPLETED** |
| 6 | List + Delete Commands | 45-60 min | **NEXT** |
| 7 | Run Command | 75-90 min | Pending |

---

## Session Progress (2026-02-01 Session 5)

### Completed
- ✅ **Step 0 (Prerequisite)**: Enum-based ID detection refactoring
  - Refactored `pkg/reference/reference.go` to use `apiresource.GetIdPrefix(kind)`
  - Replaced ALL hardcoded prefix strings (agt_, wf_, mcp-, etc.)
  - Added `isResourceIDWithKind(ref, kind)` abstraction
  - Supports both underscore (_) and hyphen (-) separators
  - Updated all tests to use correct enum-derived prefixes
  - Added dependencies on `//backend/libs/go/apiresource` and `//apis/.../apiresourcekind`
  - Result: Zero hardcoded prefixes, automatic support for new resource kinds
- ✅ **Step 1**: Created `internal/cli/agent/get.go` (84 lines)
  - `GetFromBackend(conn, orgID, reference)` - fetch agent via gRPC
  - Auto-detects ID vs slug using enum-based `reference.Parse()`
  - Uses `AgentQueryController.Get()` for IDs, `GetByReference()` for slugs
- ✅ **Step 2**: Extended `internal/cli/agent/display.go` (+77 lines, 161 total)
  - `DisplayGetResult(agent, format)` - table/yaml/json output
  - `displayAgentTable()` - human-readable summary
  - `displayAgentYAML()` - full proto as YAML (for editing)
  - `displayAgentJSON()` - full proto as JSON (for scripts)
- ✅ **Step 3**: Created `cmd/stigmer/root/agent_validate.go` (78 lines)
  - `newAgentValidateCommand()` - validate subcommand
  - `executeAgentValidate()` - load + validate without backend
  - CI-friendly exit codes (0 = valid, 1 = invalid)
- ✅ **Step 4**: Created `cmd/stigmer/root/agent_get.go` (115 lines)
  - `newAgentGetCommand()` - get subcommand
  - `executeAgentGet()` - 5-step orchestration (config → org → daemon → connect → fetch)
  - Flags: `--output` (table/yaml/json), `--org` (organization override)
- ✅ **Step 5**: Updated `cmd/stigmer/root/agent.go`
  - Registered `newAgentValidateCommand()` and `newAgentGetCommand()`
- ✅ All coding guidelines met (all files < 250 lines, functions < 50 lines)
- ✅ All tests passing (reference_test: 28 tests, agent_test: all tests)
- ✅ Changelog created: `2026-02-01-094716-agent-validate-get-commands-enum-id-detection.md`

### Key Achievement
**Architectural improvement**: Eliminated hardcoded ID prefixes across the entire CLI. The ApiResourceKind enum is now the single source of truth for resource identification. Adding new resource kinds (session, environment, artifact) requires zero CLI code changes.

### Files Created/Modified
```
client-apps/cli/cmd/stigmer/root/
├── agent_validate.go     (NEW - 78 lines)
├── agent_get.go          (NEW - 115 lines)
├── agent.go              (MODIFIED - added 2 command registrations)
└── BUILD.bazel           (MODIFIED - added 2 source files)

client-apps/cli/internal/cli/agent/
├── get.go                (NEW - 84 lines)
├── display.go            (MODIFIED - added 77 lines for get display)
└── BUILD.bazel           (MODIFIED - added get.go + 4 deps)

client-apps/cli/pkg/reference/
├── reference.go          (REFACTORED - 241 lines, enum-based detection)
├── reference_test.go     (UPDATED - all tests use enum-derived prefixes)
├── doc.go                (UPDATED - documented enum-based approach)
└── BUILD.bazel           (MODIFIED - added apiresource + apiresourcekind deps)

_changelog/2026-02/
└── 2026-02-01-094716-agent-validate-get-commands-enum-id-detection.md (NEW)
```

## Session Progress (2026-02-01 Session 4)

### Completed
- ✅ Created `cmd/stigmer/root/agent.go` (240 lines) - command group and apply subcommand
- ✅ Implemented NewAgentCommand() with 'agt' alias
- ✅ Implemented newAgentApplyCommand() with --org and --dry-run flags
- ✅ Implemented executeAgentApply() orchestration (8 steps)
- ✅ Implemented resolveAgentOrganization() helper
- ✅ Registered NewAgentCommand() in root.go
- ✅ Updated BUILD.bazel with agent.go source
- ✅ All coding guidelines met (240 lines, functions < 50 lines)
- ✅ Go vet passes, all tests pass
- ✅ Changelog created: `2026-02-01-092828-agent-apply-command-foundation.md`
- ✅ Committed: `3757f63 feat(cli/agent): add agent apply command with orchestration`

### Key Implementation
- **agent.go** (240 lines): Thin command layer orchestrating internal components
  - NewAgentCommand() - command group with alias
  - newAgentApplyCommand() - apply subcommand with flags
  - executeAgentApply() - 8-step orchestration:
    1. Load configuration
    2. Validate cross-field logic
    3. Dry-run exit path
    4. Load backend config
    5. Resolve organization
    6. Ensure daemon (local mode)
    7. Connect to backend
    8. Apply and display
  - resolveAgentOrganization() - org resolution for local/cloud
  - Mirrors mcpserver.go pattern exactly

### Files Created/Modified
```
client-apps/cli/cmd/stigmer/root/
├── agent.go          (NEW - 240 lines)
├── root.go           (MODIFIED - added NewAgentCommand() registration)
└── BUILD.bazel       (MODIFIED - added agent.go to srcs)

_changelog/2026-02/
└── 2026-02-01-092828-agent-apply-command-foundation.md (NEW)
```

## Session Progress (2026-02-01 Session 3)

### Completed
- ✅ Created `applier.go` with ApplyOptions, ApplyResult types and Apply function
- ✅ Created `display.go` with DisplayApplyResult, DisplayAgentPreview, and display helpers
- ✅ Updated BUILD.bazel with new source files and dependencies
- ✅ Changelog created: `2026-02-01-091708-agent-applier-display-foundation.md`
- ✅ Committed: `feat(cli/agent): add applier and display components`

## Session Progress (2026-02-01 Session 2)

### Completed
- ✅ Enhanced `ApiResourceReference` proto with slug/org format validation
- ✅ Added pattern validation: `^[a-z][a-z0-9-]*$` (must start with letter)
- ✅ Added length constraints: 1-63 characters
- ✅ Removed reserved field (no backward compat needed)
- ✅ Agent validator implementation (`validator.go`, 180 lines)
- ✅ Cross-field validation: unique mcp_server_usages, SubAgent mcp_access references
- ✅ Comprehensive test suite (`validator_test.go`, 250 lines, 14 test functions)
- ✅ All 28 tests passing (14 loader + 14 validator)

### Key Decisions
- **Proto validations strengthened at source**: org/slug format rules belong in proto
- **No duplication of proto rules**: Go code only validates cross-field business logic
- **Actionable error messages**: Each error includes guidance on how to fix
- **SubAgent tool subset validation**: Enforces permission inheritance model

### Files Created/Modified
```
apis/ai/stigmer/commons/apiresource/
└── io.proto           (MODIFIED - added validation rules)

client-apps/cli/internal/cli/agent/
├── validator.go       (NEW - 180 lines)
├── validator_test.go  (NEW - 250 lines)
└── BUILD.bazel        (MODIFIED - added validator files)

apis/stubs/             (REGENERATED via make protos)
```

## Session Progress (2026-02-01 Session 1)

### Completed
- ✅ Agent YAML Loader implementation (`loader.go`, 168 lines)
- ✅ Comprehensive test suite (`loader_test.go`, 367 lines, 12 test cases)
- ✅ BUILD.bazel updated with protovalidate dependency
- ✅ All tests passing via Bazel
- ✅ Enum text values fixed in tests (`skill` vs `43`, `mcp_server` vs `44`)

### Key Decisions
- **Protovalidate as single source of truth**: No manual validation in Go code
- **Strict unknown field rejection**: Catches typos early
- **Auto-detection**: `agent.yaml` or `AGENT.yaml` in current directory
- **Human-readable enums**: YAML uses text values, not numeric codes

---

## Next Steps

**Immediate** (Sub-task 6):
1. Add `stigmer agent list` command (list agents with filtering)
2. Add `stigmer agent delete` command (parse reference, confirmation, delete)
3. Implement confirmation prompt with --force flag
4. Test both commands end-to-end

**Then** (Sub-task 7):
5. Add `stigmer agent run` command (execute agents)
6. Add deprecation warning to root `run` command
7. Complete Phase 1 implementation

---

## Context for Resume

**What works now**:
- Agent YAML files can be loaded and parsed (loader.go)
- Protovalidate enforces proto schema rules + Go validates cross-field logic (validator.go)
- gRPC apply flow ready (applier.go)
- Terminal output formatting complete (display.go)
- **Agent apply command fully functional (agent.go)** ✨
- **Agent validate command - CI-friendly validation (agent_validate.go)** ✨
- **Agent get command - flexible retrieval with table/yaml/json output (agent_get.go)** ✨
- **Enum-based ID detection - zero hardcoded prefixes (reference.go)** ✨
- Command orchestration: load → validate → apply → display
- Organization resolution for local and cloud modes
- Reference parsing automatically supports all resource kinds via enum

**What's needed next**:
- Sub-task 6: Add `list` and `delete` subcommands
- Sub-task 7: Add `run` subcommand and deprecate root run

**Known Blocker**:
- Pre-existing Bazel SDK templates issue prevents full CLI build
- Issue in `new.go` dependency on `@com_github_stigmer_stigmer_sdk_go//templates`
- Agent code is correct and will work once SDK issue is resolved
- Workaround: Agent internal package builds successfully via Bazel

**Technical context**:
- Using `@build_buf_go_protovalidate//:protovalidate` dependency
- Pattern follows SDK's `agent/proto.go` validation approach
- Intentionally avoiding MCP Server loader's validation duplication

---

## Essential Files to Review

### 1. Revised Plan (AWAITING APPROVAL)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/tasks/T01_2_revised_plan.md
```

### 2. Review Feedback (Completed)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/tasks/T01_1_review.md
```

### 3. Original Plan (Superseded)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/tasks/T01_0_plan.md
```

### 4. Design Decision
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/design-decisions/001-agent-yaml-first-architecture.md
```

---

## Reference Code

### MCP Server Apply Pattern (to mirror for Agent)
```
/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer/root/mcpserver.go
/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver/loader.go
/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver/apply.go
```

### Current SDK Agent (to be removed)
```
/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go/agent/agent.go
```

### Agent Proto Definition
```
/Users/suresh/scm/github.com/stigmer/stigmer-cloud/apis/ai/stigmer/agentic/agent/v1/api.proto
/Users/suresh/scm/github.com/stigmer/stigmer-cloud/apis/ai/stigmer/agentic/agent/v1/spec.proto
```

---

## Knowledge Folders

| Folder | Purpose |
|--------|---------|
| `design-decisions/` | Architectural choices (1 decision documented) |
| `coding-guidelines/` | Project-specific patterns |
| `wrong-assumptions/` | Corrected misconceptions |
| `dont-dos/` | Anti-patterns to avoid |
| `checkpoints/` | Milestone summaries |

---

## Resume Checklist

When starting a new session:

1. [ ] Read the revised plan: `tasks/T01_2_revised_plan.md`
2. [ ] Check if developer has approved (look for approval in conversation or `T01_3_approved.md`)
3. [ ] If approved, start execution from Phase 1
4. [ ] Review feedback if needed: `tasks/T01_1_review.md`

---

## Quick Commands

After loading context:
- "Approved" or "Start Phase 1" - Begin Agent YAML-First implementation
- "Show revised plan" - I'll show T01_2_revised_plan.md
- "Show project status" - Overview of progress
- "Create checkpoint" - Save current progress

---

*Last updated: 2026-02-01 (Session 5)*
*Status: Phase 1 in progress - Sub-tasks 1-5 complete (71% done), Sub-task 6 next*
