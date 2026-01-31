# Next Task: 20260130.01.api-resource-scope-redesign

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260130.01.api-resource-scope-redesign

**Description**: Remove ApiResourceOwnerScope entirely. Adopt GitHub model: every resource belongs to an org, referenced as `org/slug`. Visibility (public/private) is orthogonal to ownership.

**Goal**: Simplify the resource ownership model to just organizations. Make SDK code portable between local, cloud, and self-hosted by using consistent `org/slug` references everywhere.

**Tech Stack**: Proto/gRPC APIs, Go SDK, Go CLI, Java backend, FGA authorization model

**Components**: apis/ai/stigmer/commons/apiresource/ (proto definitions), sdk/go/ (skillref, mcpserverref, agent helpers), stigmer-cloud/backend/ (FGA model, service layer), CLI commands

## Current Status

**Created**: 2026-01-30 08:12
**Revised**: 2026-01-31 (Phase 1 completed)
**Current Task**: T01 - Phase 1 Complete, Ready for Phase 2
**Status**: IN_PROGRESS - Phase 1 done, Phase 2-5 pending

## Session Progress (2026-01-31)

### Phase 1 COMPLETED

All proto changes implemented and validated:

1. **enum.proto**: Added `ApiResourceVisibility` enum (UNSPECIFIED/PRIVATE/PUBLIC), deleted `ApiResourceOwnerScope` enum
2. **metadata.proto**: Replaced `owner_scope` with `visibility` field at position 5
3. **io.proto**: Removed `scope` from `ApiResourceReference`, made `org` required at position 1, renumbered fields
4. **16 domain protos updated**: Removed all CEL validations referencing `owner_scope`
5. **Stubs regenerated**: Go and Python stubs regenerated and verified

### Verification Results
- `buf lint` - Passed
- `buf build` - Passed
- Go stubs compile - Passed
- `ApiResourceOwnerScope` removed from all proto files - Confirmed

## Key Design Decisions (Finalized)

| Decision | Choice |
|----------|--------|
| Ownership model | Organizations only (no personal accounts, no platform scope) |
| Reference format | `org/slug` everywhere |
| Visibility | public/private on resource metadata |
| "Official" resources | None - users trust based on org name (e.g., `stigmer/skill`) |
| Publisher permissions | Any org member can create public resources |
| Local mode | Self-contained, no external resources needed |
| SDK pattern | Single method with smart parsing: `AddSkill("slug")` or `AddSkill("org/slug")` |

## Implementation Order

1. **Phase 1**: Proto changes (add visibility, remove scope) - **COMPLETED**
2. **Phase 2**: SDK refactoring (new constructors, smart parsing) - PENDING
3. **Phase 3**: Backend changes (FGA model, service layer, data migration) - PENDING
4. **Phase 4**: CLI updates (remove --scope flags) - PENDING
5. **Phase 5**: Documentation (migration guide) - PENDING

## Next Steps (Phase 2)

When you return, start with SDK refactoring:

1. **skillref package** (`sdk/go/skillref/skillref.go`):
   - Remove `Platform()`, `Organization()` functions
   - Add `New(org, slug)` constructor
   - Add `Parse(ref string)` for "org/slug" parsing

2. **mcpserverref package** (`sdk/go/mcpserverref/mcpserverref.go`):
   - Remove `Platform()`, `Organization()`, `Personal()` functions
   - Add `New(org, slug)` constructor
   - Add `Parse(ref string)` for "org/slug" parsing

3. **Agent methods** (`sdk/go/agent/agent.go`):
   - Change `AddSkill` to accept string with smart parsing
   - Change `UseMCPServer` to accept string with smart parsing
   - Remove deprecated methods

## Essential Files to Review

### 1. Revised Plan
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.01.api-resource-scope-redesign/tasks/T01_0_plan.md
```

### 2. SDK Files to Change (Phase 2)
```
/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go/skillref/skillref.go
/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go/mcpserverref/mcpserverref.go
/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go/agent/agent.go
/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go/subagent/subagent.go
```

## Quick Commands

- "Start Phase 2" - Begin SDK refactoring
- "Show implementation status" - Check progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
