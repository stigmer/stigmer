# Next Task: 20260131.02.cli-agent-yaml-first

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: CLI Unified Architecture (ADR-005)

**Description**: Implement Dual-Track Interface for Stigmer CLI - Atomic Track (YAML-first for quick experiments) and Project Track (SDK synthesis with reconciliation for production).

**Goal**: Unified resource management where ALL resources (Agent, Workflow, Skill, MCP Server) have consistent YAML and SDK support. Project-based reconciliation enables automatic orphan cleanup.

**Architecture**: ADR-005 - Unified Resource Management & Project-Based Reconciliation

**Tech Stack**: Go (CLI), Proto definitions, gRPC APIs

**Components**: 
- CLI commands: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli`
- Go SDK: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go`
- Backend APIs: `/Users/suresh/scm/github.com/stigmer/stigmer-cloud`

---

## ARCHITECTURE CHANGE (2026-02-03)

**Previous approach** (T01_3_revised_plan.md): 
- Agent YAML-only, remove Agent from SDK
- Workflow SDK-only, no YAML support
- No Project entity, no reconciliation

**NEW approach** (T01_4_unified_architecture_plan.md based on ADR-005):
- **Dual-Track Interface**: Both YAML (Atomic) and SDK (Project) for ALL resources
- **Agent stays in SDK**: SDK is Universal Definition Language
- **Workflow gets YAML support**: Consistency across all resource types
- **Project entity**: Aggregate root for reconciliation and pruning

---

## Current Status

**Phase**: Phase 3 - Workflow YAML-First (IN PROGRESS)
**Current Sub-task**: T03.2 ✅ **COMPLETE** | T03.3 NEXT
**Architecture**: ADR-005 Unified Architecture

**Latest Session** (2026-02-03 - Session 17 - Workflow Cross-Field Validator):
- ✅ **COMPLETED Phase 3 Sub-task T03.2**: Workflow Cross-Field Validator Implementation
- Created workflow/validator.go (210 lines) with comprehensive cross-field validation
- Created comprehensive test suite (36 tests, 458 lines) - all passing
- **Validation Rules Implemented**:
  - Task name uniqueness (no duplicates across workflow)
  - Flow control references (flow.then must reference existing task or "end")
  - DAG acyclicity (no circular dependencies using DFS with path tracking)
- **Pattern Consistency**: Mirrored agent validator pattern exactly
- **Error Messages**: Actionable guidance with field paths and fix suggestions
- All engineering standards met (file sizes, function sizes, error wrapping)
- Changelog: `2026-02-03-162444-workflow-cross-field-validator.md`
- Build verified: Package builds successfully, all 36 tests passing

**Previous Session** (2026-02-03 - Session 16 - Workflow YAML Loader & Loader Simplification):
- ✅ **COMPLETED Phase 3 Sub-task T03.1**: Workflow YAML Loader Implementation
- Created workflow/loader.go (159 lines) with protovalidate integration
- Created comprehensive test suite (18 tests, 759 lines) - all passing
- **IMPORTANT IMPROVEMENT**: Simplified ALL loaders (Agent, MCP Server, Workflow)
  - Removed default filename auto-detection (~60 lines of unnecessary magic)
  - Now requires explicit file paths (like kubectl: `stigmer <resource> apply <file>`)
  - Filename is irrelevant - validation via apiVersion/kind
  - Better error messages with clear usage guidance
- Updated BUILD.bazel - Added protovalidate dependency and test target
- All engineering standards met (file sizes, function sizes, error wrapping)
- Changelog: `2026-02-03-154822-workflow-yaml-loader-and-loader-simplification.md`
- Committed: `039322e feat(cli/workflow): add YAML loader and simplify all loader interfaces`

**Previous Session** (2026-02-01 - Session 15 - Documentation and Cleanup):
- ✅ **COMPLETED Phase 2 Sub-task 8**: Documentation and Cleanup
- Fixed workflow ID prefix inconsistency: Changed `wf_` to correct `wfl_` prefix in examples
  - workflow_run.go line 56: `wfl_01kewqjbtdy0w4d14bnhhy4yc2`
  - run.go lines 42, 95: Updated to use `wfl_` prefix
- Added deprecation notice to root run.go command
  - Guides users to `stigmer agent run` and `stigmer workflow run`
  - Maintains backward compatibility while promoting new commands
- Added consistent alias examples to workflow commands
  - workflow_get.go, workflow_delete.go, workflow_run.go: Added `# Use the 'wf' alias` examples
- Created Phase 2 completion changelog documenting all 8 sub-tasks
- Verified all coding guidelines met across Phase 2 files
- Changelog: `2026-02-01-132653-phase2-workflow-commands-complete.md`

**Previous Session** (2026-02-01 - Session 14 - Workflow Run Command):
- ✅ **COMPLETED Phase 2 Sub-task 7**: Workflow Run Command Implementation
- Created cmd/stigmer/root/workflow_run.go (187 lines) - Full run command with execution support
- Updated workflow.go - Registered newWorkflowRunCommand() and removed Sub-task 7 placeholder
- Updated BUILD.bazel - Added workflow_run.go to sources
- Command structure: Mirrors agent_run.go pattern exactly (187 vs 188 lines)
- 6-step orchestration: env → connect → resolve → execute → display → stream
- Flags: `--message/-m`, `--env`, `--env-file`, `--secret`, `--secret-file`, `--follow`, `--org`
- Reference formats: ID (wf_xxx), slug, org/slug
- Reuses ~800 lines existing infrastructure: connectToBackend(), resolveWorkflow(),
  createWorkflowExecution(), streamWorkflowExecutionLogs()
- Helpful error messages with troubleshooting guidance
- Zero code duplication: Thin orchestration layer only
- All coding guidelines met (187 lines, functions <50 lines, pattern consistency)
- Build verified: workflow internal package builds, gofmt passes
- Changelog: `2026-02-01-132211-workflow-run-command.md`
- Committed: `0f207f8 feat(cli/workflow): add workflow run command with execution support`

**Previous Session** (2026-02-01 - Session 13 - Workflow Search Command):
- ✅ **COMPLETED Phase 2 Sub-task 6**: Workflow Search Command Implementation
- Created cmd/stigmer/root/workflow_search.go (153 lines) - Full search command with text query support
- Updated workflow.go - Registered newWorkflowSearchCommand() and removed Sub-task 6 placeholder
- Updated BUILD.bazel - Added workflow_search.go to sources
- Command structure: Mirrors agent_search.go pattern exactly (153 vs 151 lines)
- 5-step orchestration: validate query → config → org → daemon → connect → search
- Flags: `--output, -o` (table/yaml/json), `--org`, `--exclude-public`, `--page`, `--page-size`
- Full text search: Searches workflow names, descriptions, and tags
- Results sorted by relevance score (best matches first)
- Pagination support (default: 20 per page, max: 100)
- Organization filtering and public workflow exclusion options
- Zero code duplication: Reuses search.Search() and workflow.DisplaySearchResult()
- All coding guidelines met (153 lines, functions <50 lines, pattern consistency)
- Build verified: workflow internal package builds, search tests pass
- Changelog: `2026-02-01-131812-workflow-search-command.md`
- Committed: `ab632e2 feat(cli/workflow): add workflow search command with text query support`

**Previous Session** (2026-02-01 - Session 12 - Workflow List Command):
- ✅ **COMPLETED Phase 2 Sub-task 5**: Workflow List Command Implementation
- Created cmd/stigmer/root/workflow_list.go (139 lines) - Full list command using search infrastructure
- Updated workflow.go - Registered newWorkflowListCommand() and removed Sub-task 5 placeholder
- Updated BUILD.bazel - Added workflow_list.go to sources
- Command structure: Mirrors agent_list.go pattern exactly (139 vs 133 lines)
- 5-step orchestration: config → org → daemon → connect → search (empty query = list mode)
- Flags: `--output, -o` (table/yaml/json), `--org`, `--all-orgs`, `--page`, `--page-size`
- Full pagination support (default: 20 per page, max: 100)
- Organization filtering: Default to current context, or list from specific org or all orgs
- Zero new infrastructure: Reuses search.Search() and workflow.DisplayListResult()
- All coding guidelines met (139 lines, functions <50 lines, pattern consistency)
- Build verified: workflow internal package builds, gofmt passes
- Changelog: `2026-02-01-131321-workflow-list-command.md`
- Committed: `ab632e2 feat(cli/workflow): add workflow search command with text query support` (bundled with search)

**Previous Session** (2026-02-01 - Session 11 - Workflow Delete Command):
- ✅ **COMPLETED Phase 2 Sub-task 4**: Workflow Delete Command Implementation
- Created cmd/stigmer/root/workflow_delete.go (151 lines) - Full delete command with interactive confirmation
- Updated workflow.go - Registered newWorkflowDeleteCommand() and removed Sub-task 4 placeholder
- Updated BUILD.bazel - Added workflow_delete.go to sources
- Command structure: Mirrors agent_delete.go pattern exactly (151 vs 152 lines)
- 8-step orchestration: config → org → daemon → connect → fetch → confirm → delete → display
- Interactive confirmation via survey.Confirm (bypassable with --force)
- Flags: `--force, -f` (skip confirmation), `--org` (organization override)
- Reference resolution: slug, org/slug, or resource ID (wfl_abc123)
- Zero code duplication: Reuses 100% of workflow internal package (277 lines)
- All coding guidelines met (151 lines, functions <50 lines, pattern consistency)
- Build verified: workflow internal package builds, Go syntax validated
- Changelog: `2026-02-01-130629-workflow-delete-command.md`
- Committed: `acc029d feat(cli/workflow): add workflow delete command with interactive confirmation`

**Previous Session** (2026-02-01 - Session 10 - Workflow Get Command):
- ✅ **COMPLETED Phase 2 Sub-task 3**: Workflow Get Command Implementation
- Created cmd/stigmer/root/workflow_get.go (115 lines) - Full get command with output formats
- Updated workflow.go (79 → 110 lines) - Added resolveWorkflowOrganization() and command registration
- Updated BUILD.bazel - Added workflow_get.go to sources and workflow internal package to deps
- Command flags: --output (table/yaml/json), --org (organization override)
- 5-step orchestration: config → org → daemon → connect → fetch
- Reference resolution: slug, org/slug, or resource ID (wfl_abc123)
- Output formats: table (human-readable), yaml (for editing), json (for automation)
- Mirrors agent_get.go pattern exactly for UX consistency
- All coding guidelines met (115 lines, functions <50 lines, pattern consistency)
- Build verified: workflow internal package builds, Go vet passes
- Changelog: `2026-02-01-130334-workflow-get-command-implementation.md`
- Committed: `88073fe feat(cli/workflow): add workflow get command with output formats`

**Previous Session** (2026-02-01 - Session 9 - Workflow Command Group):
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

## Implementation Phases (REVISED per ADR-005)

| Phase | Description | Status |
|-------|-------------|--------|
| **1** | Agent YAML-First Foundation | ✅ **COMPLETED** (Atomic Track) |
| **2** | Workflow Command Restructuring | ✅ **COMPLETED** (CRUD commands) |
| **3** | Workflow YAML-First | 🆕 **PENDING** (Complete Atomic Track) |
| **4** | Project Entity & stigmer.yaml | 🆕 **PENDING** (Project Track foundation) |
| **5** | SDK Unification | 🆕 **PENDING** (All resources in SDK) |
| **6** | Project Reconciliation (Pruning) | 🆕 **PENDING** (State management) |
| **7** | Search and Discovery | ⏸️ **DEFERRED** (Lower priority) |
| **8** | Platform Capabilities (Draft Commands) | ⏸️ **DEFERRED** (Lower priority) |
| **9** | Documentation & Cleanup | ⏸️ **DEFERRED** |

**Key Changes from Previous Plan:**
- ❌ "Remove Agent from SDK" → **CANCELLED** (SDK is Universal per ADR-005)
- ✅ Phase 3: Workflow YAML support → **NEW** (Atomic Track consistency)
- ✅ Phases 4-6: Project Track → **NEW** (Reconciliation & pruning)

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

**Phase 2 COMPLETE** ✅ (8 of 8 sub-tasks complete, 100%)

✅ **Sub-task 1 COMPLETE**: Workflow Internal Package Foundation
✅ **Sub-task 2 COMPLETE**: Workflow Command Group
✅ **Sub-task 3 COMPLETE**: Workflow Get Command
✅ **Sub-task 4 COMPLETE**: Workflow Delete Command
✅ **Sub-task 5 COMPLETE**: Workflow List Command
✅ **Sub-task 6 COMPLETE**: Workflow Search Command
✅ **Sub-task 7 COMPLETE**: Workflow Run Command
✅ **Sub-task 8 COMPLETE**: Documentation and Cleanup

---

## 🆕 ARCHITECTURE REVISION: ADR-005 Adoption

**Date**: 2026-02-03
**Revised Plan**: `tasks/T01_4_unified_architecture_plan.md`

The previous plan's "two-footed approach" (YAML for Agent, SDK for Workflow) was inconsistent with DDD principles. ADR-005 introduces a **Dual-Track Interface** that provides consistent UX:

| Track | Purpose | Commands |
|-------|---------|----------|
| **Atomic** | Quick experiments | `stigmer <resource> apply <file.yaml>` |
| **Project** | Production lifecycle | `stigmer apply` (SDK synthesis + reconciliation) |

---

🚧 **NEXT: Phase 3 Sub-task T03.3** - Workflow Applier
**Action**: Create applier.go for apply operations and update display.go with DisplayApplyResult
**Plan**: See `/Users/suresh/.cursor/plans/phase_3_workflow_yaml-first_225d7b07.plan.md` → T03.3

**Sub-tasks (Phase 3)**:
- [x] T03.1: Workflow YAML Loader ✅ **COMPLETE**
- [x] T03.2: Workflow Cross-Field Validator ✅ **COMPLETE**
- [ ] T03.3: Workflow Applier (NEXT)
- [ ] T03.4: Workflow Apply Command (YAML)
- [ ] T03.5: Workflow Validate Command
- [ ] T03.6: Integration Testing and Documentation

**Phase 3 Progress**: 2 of 6 sub-tasks complete (33%)

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

**Phase 2 Progress** (Sub-tasks 1-7 Complete):
- **Sub-task 1: Workflow internal package foundation** ✅
  - internal/cli/workflow/get.go - GetFromBackend(), Get() with ID vs slug routing
  - internal/cli/workflow/delete.go - DeleteFromBackend(), Delete() with result types
  - internal/cli/workflow/display.go - All display functions (table/yaml/json)
  - internal/cli/workflow/BUILD.bazel - Dependencies configured
  - Mirrors agent package patterns exactly

- **Sub-task 2: Workflow command group** ✅
  - cmd/stigmer/root/workflow.go - NewWorkflowCommand() factory (79 → 110 lines)
  - Registered in root.go with "wf" alias
  - Comprehensive help text explaining SDK-synthesis model
  - Usage examples for all planned subcommands
  - Organization resolver: resolveWorkflowOrganization()

- **Sub-task 3: Workflow get command** ✅
  - cmd/stigmer/root/workflow_get.go - Complete get command (115 lines)
  - Reference resolution (slug, org/slug, resource ID)
  - Output formats: table/yaml/json via --output flag
  - Organization override via --org flag
  - 5-step orchestration matching agent get pattern

- **Sub-task 4: Workflow delete command** ✅
  - cmd/stigmer/root/workflow_delete.go - Complete delete command (151 lines)
  - Interactive confirmation using survey library
  - 8-step orchestration: config → org → daemon → connect → fetch → confirm → delete → display
  - Force flag (--force, -f) for bypassing confirmation
  - Mirrors agent_delete.go pattern exactly (151 vs 152 lines)

- **Sub-task 5: Workflow list command** ✅
  - cmd/stigmer/root/workflow_list.go - Full list command (139 lines)
  - Uses search infrastructure with empty query
  - Pagination support (default: 20 per page, max: 100)
  - Organization filtering: --org, --all-orgs

- **Sub-task 6: Workflow search command** ✅
  - cmd/stigmer/root/workflow_search.go - Full search command (153 lines)
  - Text search across names, descriptions, tags
  - Relevance scoring and pagination
  - Public workflow exclusion option

- **Sub-task 7: Workflow run command** ✅
  - cmd/stigmer/root/workflow_run.go - Full run command (187 lines)
  - 6-step orchestration: env → connect → resolve → execute → display → stream
  - Full flag parity with agent run command
  - Reuses ~800 lines existing run infrastructure
  - Zero code duplication

- **Sub-task 8: Documentation and cleanup** ✅
  - Fixed workflow ID prefix inconsistency (`wf_` → `wfl_`)
  - Added deprecation notice to root run.go command
  - Added consistent alias examples across all workflow commands
  - Created Phase 2 completion changelog
  - Verified all coding guidelines met

**Phase 2 Complete**: All 8 sub-tasks finished. The workflow command group now provides full parity with agent commands.

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

### 1. ADR-005: Unified Architecture (CURRENT)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_cursor/adr-doc.md
```

### 2. NEW Unified Architecture Plan (AWAITING APPROVAL)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/tasks/T01_4_unified_architecture_plan.md
```

### 3. Previous Plan (SUPERSEDED by T01_4)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/tasks/T01_3_revised_plan.md
```

### 4. Original Design Decision (Context)
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

1. [ ] Read ADR-005: `_cursor/adr-doc.md`
2. [ ] Read the unified plan: `tasks/T01_4_unified_architecture_plan.md`
3. [ ] Check current phase status in this file
4. [ ] If Phase 3 approved, start Workflow YAML-First implementation

---

## Quick Commands

After loading context:
- "Approved" or "Start Phase 3" - Begin Workflow YAML-First implementation
- "Show unified plan" - I'll show T01_4_unified_architecture_plan.md
- "Show project status" - Overview of progress
- "Create checkpoint" - Save current progress

---

*Last updated: 2026-02-03 (Architecture Revision Session)*
*Status: Phase 1 ✅, Phase 2 ✅, Phase 3 AWAITING APPROVAL*
*Architecture: ADR-005 Dual-Track Interface adopted*
