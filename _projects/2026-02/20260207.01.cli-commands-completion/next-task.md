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
**Updated**: 2026-02-07 14:17
**Current Task**: T02 (Type Registry Foundation)
**Status**: ✅ COMPLETED

## Session Progress (2026-02-07)

### What Was Accomplished
- ✅ **T02: Type Registry Foundation - COMPLETE**
  - Created proto-driven type registry (`internal/cli/types/`)
  - Implemented algorithmic alias generation (no manual duplication)
  - Built verb support matrix for all CLI-relevant kinds
  - Added YAML kind detection (light, fast)
  - Full test coverage (all tests passing)
  - Bazel build verified

### Key Implementation Details
- **11 files created** (~1,523 total lines including tests)
- **Files**: doc.go, verb.go, typeinfo.go, aliases.go, verb_support.go, registry.go, detect.go, + tests + BUILD.bazel
- **Proto-driven**: Registry built from `api_resource_kind.proto` metadata
- **Algorithmic aliases**: Generated from Name/DisplayName/IdPrefix (mcp-server, mcpserver, MCP, etc.)
- **CLI-relevant kinds**: Agent, Workflow, Skill, McpServer, Project (filtered by TIER_OPEN_SOURCE)

### Technical Decisions Made
1. **No CLI-specific kind enum** - Use proto `ApiResourceKind` directly
2. **Case-insensitive lookup** - All aliases normalized to lowercase
3. **Light detection** - Extract kind/apiVersion only, no full parsing
4. **Multi-doc YAML support** - Handle `---` separated documents

### Files Created
```
client-apps/cli/internal/cli/types/
  ├── aliases.go              (100 lines)
  ├── aliases_test.go         (163 lines)
  ├── detect.go               (136 lines)
  ├── detect_test.go          (251 lines)
  ├── doc.go                  (37 lines)
  ├── registry.go             (143 lines)
  ├── registry_test.go        (288 lines)
  ├── typeinfo.go             (55 lines)
  ├── verb.go                 (59 lines)
  ├── verb_support.go         (85 lines)
  └── BUILD.bazel             (33 lines)
```

### Verification Complete
- ✅ `bazel build //client-apps/cli/internal/cli/types/...` passes
- ✅ `bazel test //client-apps/cli/internal/cli/types/...` passes (all tests)
- ✅ No linter errors
- ✅ Follows coding guidelines (files <250 lines, functions <50 lines)

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
| **T03** | Core Verbs - apply, validate, get, list, delete | 📋 NEXT |
| **T04** | Specialized Verbs - run, push, search with validation | 📋 TODO |
| **T05** | Resources Command - discoverability | 📋 TODO |
| **T06** | Fill Gaps - Skill/MCP/Project handlers | 📋 TODO |
| **T07** | Migration - Remove old resource-specific commands | 📋 TODO |
| **T08** | Testing & Docs | 📋 TODO |

## Next Steps

### Immediate Next Action (T03)
1. Implement core verb commands using the type registry
2. Create unified `apply` command with kind detection
3. Implement `validate`, `get`, `list`, `delete` commands
4. Add command routing based on TypeInfo and verb support

### Context for Resume
- Type registry is production-ready and tested
- Registry provides `GetByAlias()` for case-insensitive type lookup
- Verb support matrix defines which types support which verbs
- Detection logic handles both single and multi-doc YAML files
- All foundations in place to build actual commands
- Plan file available at: `/Users/suresh/.cursor/plans/cli_type_registry_76fa1362.plan.md`

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

- "Continue with T03" - Start implementing core verb commands
- "Show task plan" - Review T02_0_plan.md details
- "What was the research?" - See research.cli-command-structure-patterns/

---

*This file provides direct paths to all project resources for quick context loading.*
*Last updated: 2026-02-07 14:17 (T02 Complete - Ready for T03)*
