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
**Revised**: 2026-01-31 (Phase 2 Sub-Task 1 completed)
**Current Task**: Phase 2, Sub-Task 1 COMPLETE - New `skill` package created
**Status**: IN_PROGRESS - Phase 1 done, Phase 2 Sub-Task 1 done, continuing Phase 2

## Session Progress (2026-01-31)

### Latest Session (2026-01-31 Evening)

**Accomplished - Phase 2, Sub-Task 1: Create `skill` Package**

Created brand new `sdk/go/skill/` package with intuitive org/slug API:

1. **skill.go** (139 lines)
   - `New(org, slug, opts...)` - Constructor with explicit org/slug
   - `Parse(ref)` - Parses "org/slug" or "org/slug@version" format
   - `MustParse(ref)` - Parse variant that panics on error
   - `WithVersion(v)` - Option for setting version

2. **errors.go** (45 lines)
   - Sentinel errors: `ErrInvalidFormat`, `ErrEmptyOrg`, `ErrEmptySlug`
   - `ParseError` type with context and Unwrap support

3. **doc.go** (53 lines)
   - Comprehensive package documentation with examples

4. **skill_test.go** (310 lines)
   - 27 test cases covering all functions and edge cases
   - All tests passing ✅

**Verification Results:**
- `go build ./skill/...` - Passed ✅
- `go test -v ./skill/...` - All 27 tests passed ✅
- No linter errors ✅
- Bazel BUILD not needed (SDK uses Go modules)

**Key Decisions Made:**
- Used functional Option pattern for version parameter (clean, extensible)
- ParseError wraps sentinel errors for better error checking with errors.Is/As
- Parse handles edge cases: multiple slashes, @ in version, empty parts
- MustParse panics for init-time/test usage (Go convention)

### Previous Session (2026-01-31)

**Phase 1 COMPLETED**

All proto changes implemented and validated:

1. **enum.proto**: Added `ApiResourceVisibility` enum (UNSPECIFIED/PRIVATE/PUBLIC), deleted `ApiResourceOwnerScope` enum
2. **metadata.proto**: Replaced `owner_scope` with `visibility` field at position 5
3. **io.proto**: Removed `scope` from `ApiResourceReference`, made `org` required at position 1, renumbered fields
4. **16 domain protos updated**: Removed all CEL validations referencing `owner_scope`
5. **Stubs regenerated**: Go and Python stubs regenerated and verified

**Verification Results:**
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

## Next Steps (Immediate - Sub-Task 2)

**Ready to continue**: Sub-Task 2 - Create `mcpserver` Package

Follow the same pattern as the `skill` package just created:

1. **Create `sdk/go/mcpserver/` package** (45-60 minutes estimated)
   - `mcpserver.go`: `New(org, slug)`, `Parse(ref)`, `MustParse(ref)`
   - `errors.go`: Same sentinel errors and ParseError pattern
   - `doc.go`: Package documentation (note: MCP servers NOT versioned)
   - `mcpserver_test.go`: Full test coverage
   - Verify: `go build ./mcpserver/...` and `go test -v ./mcpserver/...`

2. **Then Sub-Task 3**: Add smart parsing to Agent package
3. **Then Sub-Task 4**: Add smart parsing to SubAgent package
4. **Then Sub-Tasks 5-8**: Migrate examples, tests, docs, cleanup

## Context for Resume

**What You Need to Know:**

1. **The `skill` package is the reference implementation** - When creating `mcpserver`, follow the exact same pattern:
   - File structure: mcpserver.go, errors.go, doc.go, mcpserver_test.go
   - Functions: New(), Parse(), MustParse() (no WithVersion option - MCP servers aren't versioned)
   - Error handling: Same ParseError wrapper with sentinel errors
   - Test coverage: Similar test cases (minus version-related tests)

2. **Current SDK build status**: The old packages (`skillref`, `mcpserverref`, `subagent`) still reference removed `Scope` field, causing build errors. This is expected - they'll be fixed/removed in later sub-tasks.

3. **Key difference for mcpserver**: MCP servers do NOT support versioning, so:
   - No `WithVersion()` option
   - No version parameter anywhere
   - Parse only accepts "org/slug" (not "org/slug@version")
   - Tests don't need version test cases

4. **Reference files to read when resuming**:
   - `sdk/go/skill/skill.go` - Template for mcpserver.go structure
   - `sdk/go/skill/errors.go` - Exact error pattern to replicate
   - `sdk/go/skill/skill_test.go` - Test structure (remove version tests)
   - `.cursor/plans/sdk_skill_package_refactor_3ff5a18c.plan.md` - Overall plan

5. **Uncommitted work**: New `sdk/go/skill/` directory ready for commit. Consider committing Sub-Task 1 before starting Sub-Task 2, or batch commit after Sub-Task 2.

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
