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

**Phase**: Phase 2 - Workflow Command Restructuring (IN PROGRESS 🚧)
**Current Task**: Sub-task 2 COMPLETED ✅, Ready for Sub-task 3
**Status**: 2 of 8 Sub-tasks COMPLETED ✅ (25% complete)

**Latest Session** (2026-02-01 - Session 9 - Workflow Command Group):
- ✅ **COMPLETED Phase 2 Sub-task 2**: Workflow Command Group Foundation
- Created cmd/stigmer/root/workflow.go (79 lines) - NewWorkflowCommand() factory
- Registered NewWorkflowCommand() in root.go (line 50)
- Updated BUILD.bazel to add workflow.go to sources (line 31)
- Command group with alias "wf" (consistent with "agt" for agent)
- Comprehensive help text explaining SDK-synthesis model
- Documents workflow lifecycle: define (SDK) → deploy (apply) → execute (run)
- Comparison with YAML-first agents for clarity
- Usage examples for all planned subcommands (get, delete, list, search, run)
- Subcommands to be added in sub-tasks 3-7 (placeholder comments in code)
- All coding guidelines met (79 lines, no business logic, pattern consistency)
- Build verified: workflow internal package builds, Go syntax validated
- Note: Root package build blocked by pre-existing SDK templates issue
- Changelog: `2026-02-01-125536-workflow-command-group-foundation.md`
- Committed: `1e8f1b4 feat(cli/workflow): add workflow command group foundation`

**Previous Session** (2026-02-01 - Session 8 - Phase 2 Start):
- ✅ **COMPLETED Phase 2 Sub-task 1**: Workflow Internal Package Foundation
- Created internal/cli/workflow/ package (380 lines across 4 files)
- get.go (84 lines) - GetFromBackend(), Get() with ID vs slug routing
- delete.go (77 lines) - DeleteFromBackend(), Delete() with result types
- display.go (194 lines) - All display functions (table/yaml/json formats)
- BUILD.bazel (25 lines) - Bazel build definition
- Mirrors agent package patterns exactly
- Differences from agent: No applier/loader/validator (workflows are SDK-synthesized)
- Enum-based ID detection (no hardcoded prefixes)
- All coding guidelines met (files <250 lines, functions <50 lines)
- Build verified: bazel build successful, no linter errors
- Changelog: `2026-02-01-125008-workflow-internal-package-foundation.md`
- Committed: `4922494 feat(cli/workflow): add workflow internal package foundation`

**Previous Session** (2026-02-01 - Session 7):
- ✅ Completed Phase 1 Sub-task 7: Run Command (FINAL for Phase 1)
- Created agent_run.go (188 lines) - thin orchestration reusing run_*.go infrastructure
- Added deprecation warning to run.go directing users to resource-specific commands
- Registered run command in agent.go with enhanced examples
- Updated BUILD.bazel with agent_run.go
- Full flag parity with root run: --message/-m, --env, --env-file, --secret, --secret-file, --follow, --org
- Reused ~800 lines of existing execution infrastructure (no duplication)
- Agent internal package builds successfully
- All tests passing
- Changelog: `2026-02-01-123224-agent-run-command.md`

**Previous Session** (2026-02-01 - Session 6):
- ✅ Completed Sub-task 6: List + Delete Commands
- Created agent_list.go (46 lines) - placeholder with helpful message
- Created agent_delete.go (151 lines) - full delete with interactive confirmation
- Created delete.go (84 lines) - gRPC delete orchestration
- Extended display.go (+29 lines) - delete confirmation and results
- Updated BUILD files with new sources
- Registered list and delete commands in agent.go
- Interactive confirmation using survey library (improved over MCP Server pattern)
- Force flag for scripting scenarios
- All tests passing (28 tests in agent package)
- Changelog: `2026-02-01-100309-agent-list-delete-commands.md`
- Committed: `c5c8793 feat(cli/agent): add list and delete commands`

**Previous Session** (2026-02-01 - Session 5):
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
| **1** | Agent YAML-First Foundation | ✅ **COMPLETED** (7 of 7 sub-tasks) |
| **2** | Workflow Command Restructuring | 🚧 **IN PROGRESS** (2 of 8 sub-tasks complete, 25%) |
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
| 6 | List + Delete Commands | 45-60 min | ✅ **COMPLETED** |
| 7 | Run Command | 75-90 min | ✅ **COMPLETED** |

---

## Session Progress (2026-02-01 Session 7) - PHASE 1 COMPLETE

### Completed
- ✅ **Step 1**: Created `cmd/stigmer/root/agent_run.go` (188 lines)
  - `newAgentRunCommand()` - run subcommand with comprehensive flags
  - `executeAgentRun()` - orchestration: env → connect → resolve → execute → stream
  - Flags: `--message/-m`, `--env`, `--env-file`, `--secret`, `--secret-file`, `--follow`, `--org`
  - Full flag parity with root `run` for seamless migration
- ✅ **Step 2**: Updated `cmd/stigmer/root/agent.go`
  - Registered `newAgentRunCommand()` subcommand
  - Enhanced examples with run command usage
- ✅ **Step 3**: Updated `cmd/stigmer/root/run.go`
  - Added deprecation warning at start of Run function
  - Directs users to `stigmer agent run` and `stigmer workflow run`
- ✅ **Step 4**: Updated `cmd/stigmer/root/BUILD.bazel`
  - Added `agent_run.go` to sources
- ✅ All coding guidelines met (188 lines, functions follow patterns)
- ✅ Agent internal package builds successfully
- ✅ All tests passing
- ✅ Changelog created: `2026-02-01-123224-agent-run-command.md`

### Key Achievement
**Phase 1 Complete**: All 7 sub-tasks finished. The agent run command reuses ~800 lines of existing execution infrastructure from `run_*.go` files with zero duplication. Deprecation warning guides users toward resource-specific commands while maintaining backward compatibility.

### Files Created/Modified
```
cmd/stigmer/root/
├── agent_run.go         (NEW - 188 lines)
├── agent.go             (MODIFIED - registered run command + examples)
├── run.go               (MODIFIED - added deprecation warning)
└── BUILD.bazel          (MODIFIED - added agent_run.go)

_changelog/2026-02/
└── 2026-02-01-123224-agent-run-command.md (NEW)
```

---

## Session Progress (2026-02-01 Session 6)

### Completed
- ✅ **Step 1**: Created `internal/cli/agent/delete.go` (77 lines)
  - `DeleteFromBackend(conn, agentID)` - low-level gRPC delete
  - `Delete(opts)` - high-level delete with validation
  - Uses `AgentCommandController.Delete(ctx, *AgentId)` API
  - Returns deleted agent for confirmation display
- ✅ **Step 2**: Extended `internal/cli/agent/display.go` (+29 lines, 191 total)
  - `DisplayDeleteResult(result)` - success message with deleted agent details
  - `DisplayDeleteConfirmation(agent)` - pre-deletion warning display
- ✅ **Step 3**: Created `cmd/stigmer/root/agent_delete.go` (151 lines)
  - `newAgentDeleteCommand()` - delete subcommand
  - `executeAgentDelete()` - 8-step orchestration (config → org → daemon → connect → fetch → confirm → delete → display)
  - `confirmAgentDeletion()` - interactive confirmation using survey library
  - Flags: `--force, -f` (skip confirmation), `--org` (organization override)
- ✅ **Step 4**: Created `cmd/stigmer/root/agent_list.go` (46 lines)
  - `newAgentListCommand()` - list placeholder command
  - Helpful message explaining List API not yet available
  - Examples showing how to use `stigmer agent get` instead
- ✅ **Step 5**: Updated `cmd/stigmer/root/agent.go`
  - Registered `newAgentListCommand()` and `newAgentDeleteCommand()`
  - Updated command examples
- ✅ **Step 6**: Updated BUILD files
  - Added agent_delete.go and agent_list.go to root BUILD.bazel
  - Added delete.go to agent BUILD.bazel
- ✅ All coding guidelines met (all files < 250 lines, functions < 50 lines)
- ✅ All tests passing (agent_test: 28 tests)
- ✅ Agent internal package builds successfully with Bazel
- ✅ Changelog created: `2026-02-01-100309-agent-list-delete-commands.md`
- ✅ Committed: `c5c8793 feat(cli/agent): add list and delete commands`

### Key Achievement
**Production-ready delete command**: Implemented complete delete workflow with interactive confirmation using survey library, improving upon MCP Server's incomplete confirmation pattern. Force flag enables scripting scenarios. List command provides helpful placeholder maintaining command discoverability.

### Files Created/Modified
```
client-apps/cli/cmd/stigmer/root/
├── agent_delete.go      (NEW - 151 lines)
├── agent_list.go        (NEW - 46 lines)
├── agent.go             (MODIFIED - added 2 command registrations + examples)
└── BUILD.bazel          (MODIFIED - added 2 source files)

client-apps/cli/internal/cli/agent/
├── delete.go            (NEW - 77 lines)
├── display.go           (MODIFIED - added 29 lines for delete display)
└── BUILD.bazel          (MODIFIED - added delete.go)

_changelog/2026-02/
└── 2026-02-01-100309-agent-list-delete-commands.md (NEW)
```

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

**Phase 2 IN PROGRESS** (1 of 8 sub-tasks complete)

✅ **Sub-task 1 COMPLETE**: Workflow Internal Package Foundation
- Created internal/cli/workflow/ package with get, delete, display operations
- Ready for consumption by command layer

🚧 **NEXT: Sub-task 2** - Workflow Command Group
**Action**: Create workflow.go command group and register in root.go
**Estimated**: 45-60 minutes
**Files to create**:
1. `cmd/stigmer/root/workflow.go` (~80 lines)
   - `NewWorkflowCommand()` - Command group factory
   - Alias: `wf`
   - Long description explaining SDK synthesis model
   - Register all subcommands (initially empty, filled in later sub-tasks)
2. Modify `cmd/stigmer/root/root.go`
   - Add `rootCmd.AddCommand(root.NewWorkflowCommand())`
3. Update `cmd/stigmer/root/BUILD.bazel`
   - Add `workflow.go` to sources
**Pattern reference**: `cmd/stigmer/root/agent.go` lines 15-72
**Success criteria**: `stigmer workflow --help` displays command group

**Remaining Sub-tasks**:
- Sub-task 3: Workflow Get Command (45-60 min)
- Sub-task 4: Workflow Delete Command (60-75 min)
- Sub-task 5: Workflow List Command (30-45 min)
- Sub-task 6: Workflow Search Command (45-60 min)
- Sub-task 7: Workflow Run Command (60-75 min)
- Sub-task 8: Documentation and Cleanup (30-45 min)

---

## Context for Resume

**Phase 1 Complete** ✅:
- Agent YAML files can be loaded and parsed (loader.go)
- Protovalidate enforces proto schema rules + Go validates cross-field logic (validator.go)
- gRPC apply flow ready (applier.go)
- Terminal output formatting complete (display.go)
- Agent apply command fully functional (agent.go)
- Agent validate command - CI-friendly validation (agent_validate.go)
- Agent get command - flexible retrieval with table/yaml/json output (agent_get.go)
- Agent list command - helpful placeholder until backend RPC available (agent_list.go)
- Agent delete command - production-ready with interactive confirmation (agent_delete.go)
- Agent run command - execute agents with full flag support (agent_run.go)
- Root run deprecation warning - guides users to resource-specific commands
- Enum-based ID detection - zero hardcoded prefixes (reference.go)
- Command orchestration: load → validate → apply → display
- Organization resolution for local and cloud modes
- Reference parsing automatically supports all resource kinds via enum
- Interactive confirmations using survey library
- Full agent lifecycle: apply → get → run → delete

**Phase 2 Progress** (Sub-tasks 1-2 Complete):
- **Sub-task 1: Workflow internal package foundation** ✅
  - internal/cli/workflow/get.go - GetFromBackend(), Get() with ID vs slug routing
  - internal/cli/workflow/delete.go - DeleteFromBackend(), Delete() with result types
  - internal/cli/workflow/display.go - All display functions (table/yaml/json)
  - internal/cli/workflow/BUILD.bazel - Dependencies configured
  - Mirrors agent package patterns exactly

- **Sub-task 2: Workflow command group** ✅
  - cmd/stigmer/root/workflow.go - NewWorkflowCommand() factory (79 lines)
  - Registered in root.go with "wf" alias
  - Comprehensive help text explaining SDK-synthesis model
  - Usage examples for all planned subcommands
  - Ready for sub-task 3 (workflow_get.go)

**What's needed next**:
- **Sub-task 3**: Implement workflow_get.go with table/yaml/json output formats
- **Sub-task 4**: Implement workflow_delete.go with interactive confirmation
- **Sub-task 5**: Create workflow_list.go placeholder command
- **Sub-task 6**: Implement workflow_search.go using existing search infrastructure
- **Sub-task 7**: Implement workflow_run.go reusing run_*.go infrastructure
- **Sub-task 8**: Documentation, changelog, and final cleanup

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

*Last updated: 2026-02-01 (Session 7)*
*Status: Phase 1 COMPLETE ✅ - All 7 sub-tasks finished, Phase 2 next*
