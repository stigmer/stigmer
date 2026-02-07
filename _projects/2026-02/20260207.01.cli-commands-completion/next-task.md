# Next Task: 20260207.01.cli-commands-completion

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260207.01.cli-commands-completion

**Description**: Complete and standardize CLI commands for all five resource types (Agent, Workflow, Skill, MCP Server, Project), ensuring command parity across resources.
**Goal**: Ensure all five resource types have consistent command coverage with apply/get/list/delete/validate at minimum. Add missing commands: Skill get/list/delete, MCP Server validate/search/list, Project list.
**Tech Stack**: Go/Cobra CLI
**Components**: client-apps/cli/cmd/stigmer/root/, client-apps/cli/internal/cli/

## Current Status

**Created**: 2026-02-07 11:31
**Updated**: 2026-02-07 16:00
**Current Task**: T05 (Resources Command)
**Status**: ✅ COMPLETED

## Session Progress (2026-02-07)

### Latest Session (16:00) - T05 Complete

- ✅ **T05: Resources Command - COMPLETE**
  - Created `stigmer resources` command for CLI discoverability
  - Supports table/yaml/json output formats
  - Implements `--verb` filter to show types supporting specific verbs
  - Added `VerbFromString()` and `AllVerbNames()` to types package
  - Registry-driven (no hardcoded resource lists)
  - Clean table formatting with aliases and verb support
  - Comprehensive help text with examples
  - Go build successful, all formats tested

### Key Implementation Details - T05
- **1 new command file** (225 lines)
  - `resources.go` - Full command implementation
- **1 updated types file** (+36 lines)
  - `verb.go` - Added verb parsing and name functions
- **2 config files updated**
  - `root.go` - Registered resources command
  - `BUILD.bazel` - Added yaml.v3 dependency
- **Net result**: +261 lines of discoverability infrastructure

### Technical Decisions Made - T05
1. **Command name** - `resources` (kubectl-aligned, domain-appropriate)
2. **Output formats** - Support table/yaml/json for programmatic use
3. **Verb filtering** - Enable `--verb` flag to filter by operation
4. **Alias display** - Show only useful aliases in table (ID prefix + plural)
5. **Full metadata** - Include all aliases in JSON/YAML for completeness
6. **Error messaging** - Clear errors for invalid verbs with available options

### Earlier Session (15:16) - T04 Complete

- ✅ **T04: Specialized Verbs Migration - COMPLETE**
  - Created 3 unified specialized verb commands: `run`, `search`, `push`
  - Unified `resolveOrganization` helper (removed 3 duplicates)
  - Extracted run handlers to `run_handlers.go` (96 lines)
  - Deleted 5 obsolete files: `agent_run.go`, `workflow_run.go`, `agent_search.go`, `workflow_search.go`, `run_execute.go`
  - Deprecated parent commands (agent, workflow, skill) with migration guidance
  - Updated root.go to register new commands
  - Go build successful, all verbs validated
  
### Key Implementation Details - T04
- **3 new unified verb files** (~583 lines)
  - `run.go` (191 lines), `search.go` (182 lines), `push.go` (210 lines)
- **1 handler file** (96 lines)
  - `run_handlers.go` (agent/workflow execution logic)
- **1 updated helper file**
  - `verb_helpers.go` (added unified resolveOrganization)
- **5 old files deleted** (~1,066 lines removed)
- **Net result**: -483 lines (31% reduction in specialized verb code)

### Technical Decisions Made - T04
1. **Unified run pattern** - `stigmer run <type> <ref>` for agents and workflows
2. **Unified search pattern** - `stigmer search <type> <query>` with pagination
3. **Unified push pattern** - `stigmer push <type> [path]` for skills
4. **Helper consolidation** - Single `resolveOrganization` in verb_helpers.go
5. **Handler extraction** - Separated run handlers for SRP compliance (<250 lines)
6. **Deprecated parents** - agent/workflow/skill commands show migration guidance
7. **Auto-discovery removed** - Dropped from run command per user decision

### Earlier Session (14:44) - T03 Complete

- ✅ **T03: Core Verbs Implementation - COMPLETE**
  - Created 5 unified verb commands: `apply`, `validate`, `get`, `list`, `delete`
  - Extracted MCP server handlers to `internal/cli/mcpserver/`
  - Added `LoadFromBytes` to all resource loaders for multi-doc YAML
  - Removed 13 old noun-first command files (2,689 lines deleted)
  - Refactored agent/workflow parent commands to keep only specialized verbs
  - Updated help text with migration guidance
  - Fixed template import path issues
  - Go build successful, Bazel packages build

### Key Implementation Details - T03
- **6 new command files** (~1,140 lines of unified logic)
  - `apply_file.go`, `validate.go`, `get.go`, `list.go`, `delete.go`, `verb_helpers.go`
- **3 extracted handler files** (~272 lines)
  - `mcpserver/get.go`, `mcpserver/delete.go`, `mcpserver/display.go`
- **13 old files deleted** (2,689 lines removed)
  - All noun-first core verb commands (agent_apply, workflow_get, mcpserver.go, etc.)
- **Net result**: -1,549 lines (58% code reduction)

### Technical Decisions Made - T03
1. **Unified routing pattern** - All commands: resolve type → check verb support → route to handler
2. **File mode vs project mode** - `apply` with `-f` flag for files, without for projects
3. **Delete confirmation** - Fetch resource first, show details, require --force to skip
4. **List uses search.List** - Leverages existing search infrastructure with DisplayOptions
5. **Template migration** - Moved from sdk/go/internal/templates to cli/embedded (resolves Go import issue)
6. **Verb-first preservation** - Kept agent/workflow parent for specialized verbs (run, search)

### Earlier Session (14:17) - T02 Complete

- ✅ **T02: Type Registry Foundation - COMPLETE**
  - Created proto-driven type registry (`internal/cli/types/`)
  - Implemented algorithmic alias generation
  - Built verb support matrix for all CLI-relevant kinds
  - Added YAML kind detection (light, fast)
  - Full test coverage (all tests passing)

### Files Modified (T03)
```
Modified (10):
  - cmd/stigmer/root.go (registered new commands)
  - cmd/stigmer/root/BUILD.bazel (updated deps)
  - cmd/stigmer/root/agent.go (removed core verbs, kept run/search)
  - cmd/stigmer/root/workflow.go (removed core verbs, kept run/search)
  - cmd/stigmer/root/apply.go (added -f flag, dispatcher logic)
  - cmd/stigmer/root/new.go (fixed template import)
  - internal/cli/{agent,workflow,mcpserver,project}/loader.go (added LoadFromBytes)
  - embedded/BUILD.bazel (added templates.go)

Created (6):
  - cmd/stigmer/root/apply_file.go
  - cmd/stigmer/root/validate.go
  - cmd/stigmer/root/get.go
  - cmd/stigmer/root/list.go
  - cmd/stigmer/root/delete.go
  - cmd/stigmer/root/verb_helpers.go
  - embedded/templates.go
  - internal/cli/mcpserver/{get,delete,display}.go

Deleted (13):
  - cmd/stigmer/root/agent_{apply,get,list,delete,validate}.go
  - cmd/stigmer/root/workflow_{apply,get,list,delete,validate}.go
  - cmd/stigmer/root/mcpserver.go (entire 657-line parent command)
  - cmd/stigmer/root/project.go
  - cmd/stigmer/root/project_{get,delete}.go
```

### Verification Complete - T03
- ✅ Go build successful (`go build ./cmd/stigmer/...`)
- ✅ Bazel packages build (individual packages verified)
- ✅ Command help text correct (all 5 verbs + agent/workflow)
- ✅ No linter errors
- ✅ Follows coding guidelines (files <250 lines except delete.go at 260)
- ⚠️ Bazel full build has pre-existing backend visibility issue (unrelated to T03)

## Architecture Decision: Pure Verb-First

Based on [Deep Research](./research.cli-command-structure-patterns/04.report.gpt.md) + user feedback:

**100% verb-first, no aliases, type + id as separate args**

```bash
# File-based (auto-detect kind)
stigmer apply -f agent.yaml
stigmer validate -f workflow.yaml

# Reference-based (type + id/slug as separate args)
stigmer get agent abc123
stigmer get agent myorg/my-agent
stigmer list agents
stigmer delete workflow def456

# Specialized verbs (same verb-first pattern)
stigmer run workflow abc123
stigmer push skill
stigmer search agents "query"

# Discoverability
stigmer resources
```

## Task Breakdown

| Task | Description | Status |
|------|-------------|--------|
| **T02** | Type Registry - resource types, verb support matrix, YAML detection | ✅ COMPLETED |
| **T03** | Core Verbs - apply, validate, get, list, delete | ✅ COMPLETED |
| **T04** | Specialized Verbs - run, push, search with validation | ✅ COMPLETED |
| **T05** | Resources Command - discoverability | ✅ COMPLETED |
| **T06** | Fill Gaps - Skill/MCP/Project handlers | 📋 NEXT |
| **T07** | Migration - Remove old resource-specific commands | 📋 TODO |
| **T08** | Testing & Docs | 📋 TODO |

## Next Steps

### Immediate Next Action (T06)
1. Implement missing Skill handlers (get, list, delete)
2. Implement missing MCP Server handlers (validate, complete list)
3. Implement missing Project handlers (list)
4. Add proper error handling for unimplemented operations
5. Test all gap-filled commands
4. Add type alias information
5. Consider adding autocomplete support

### Context for Resume
- ✅ Core verbs (apply, validate, get, list, delete) are complete and working
- ✅ Specialized verbs (run, push, search) are complete and working
- ✅ Resources command (discoverability) is complete and working
- ✅ Type registry provides routing and validation for all commands
- ✅ All commands follow verb-first pattern
- ✅ Old noun-first parent commands deprecated with migration guidance
- ✅ Helper functions unified (resolveOrganization)
- ✅ File size constraints met (all files <250 lines)
- 📋 Need to implement missing handlers (Skill/MCP/Project gaps in T06)
- Plan files available:
  - T03: `/Users/suresh/.cursor/plans/t03_core_verbs_53f217e9.plan.md`
  - T04: `/Users/suresh/.cursor/plans/t04_specialized_verbs_a530bfd0.plan.md`
  - T05: `/Users/suresh/.cursor/plans/t05_resources_command_d5683b19.plan.md`
- Changelog available:
  - T03: `_changelog/2026-02/2026-02-07-144348-cli-core-verbs-unified-architecture.md`

## Key Decisions

| Decision | Choice |
|----------|--------|
| Backward compat aliases | **No** - keep it simple |
| Specialized verbs | **Verb-first** - `run workflow` not `workflow run` |
| Reference format | **Separate args** - `get agent abc123` not `get agent/abc123` |
| Unsupported combos | **Validation error** with helpful message |

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.01.cli-commands-completion/dont-dos/`
6. [ ] Continue with T03 (Core Verbs)

## Quick Commands

- "Continue with T06" - Start implementing missing Skill/MCP/Project handlers
- "Show T05 plan" - Review t05_resources_command_d5683b19.plan.md
- "Show T04 plan" - Review t04_specialized_verbs_a530bfd0.plan.md
- "What was accomplished?" - Read changelog at `_changelog/2026-02/2026-02-07-144348-cli-core-verbs-unified-architecture.md`

---

*This file provides direct paths to all project resources for quick context loading.*
*Last updated: 2026-02-07 16:00 (T05 Complete - Ready for T06)*

## Uncommitted Changes

⚠️ **Uncommitted changes for T05**

**Modified files (4)**:
- `next-task.md` - Updated with T05 progress
- `client-apps/cli/cmd/stigmer/root.go` - Registered resources command
- `client-apps/cli/cmd/stigmer/root/BUILD.bazel` - Added resources.go and yaml.v3 dep
- `client-apps/cli/internal/cli/types/verb.go` - Added VerbFromString and AllVerbNames

**New files (1)**:
- `client-apps/cli/cmd/stigmer/root/resources.go` - Full resources command (225 lines)

**Ready to commit**: All changes pass Go build, features tested

---

*This file provides direct paths to all project resources for quick context loading.*
*Last updated: 2026-02-07 15:16 (T04 Complete - Ready for T05)*
