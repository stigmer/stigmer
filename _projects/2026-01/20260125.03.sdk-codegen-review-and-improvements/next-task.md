# SDK Code Generation Review and Improvements - Quick Resume

**Project**: sdk-codegen-review-and-improvements  
**Status**: IN_PROGRESS  
**Last Updated**: 2026-01-26

---

## Current State

**Phase**: Foundation Refactoring  
**Current Task**: Phase 1.1 COMPLETE - Next: Choose from available tasks  
**Build Status**: PASSES (`go build ./...` succeeds)

---

## Session Progress (2026-01-26)

### Completed Today

#### Phase 1.1: Delete mcpserver/options.go
- **File deleted**: `sdk/go/mcpserver/options.go` (337 lines, 8.5KB)
- **Content**: All unused functional options (`WithName`, `WithCommand`, `WithArgs`, etc.)
- **Reason**: Dead code - implementations now use struct args pattern
- **Build**: PASSES

### Previously Completed (Phase 1: Skill Package Refactoring)

1. **Deleted old skill package** (7 files, -23KB):
   - `sdk/go/skill/` - entire directory removed
   - `sdk/go/gen/skill/skillspec_args.go` - not needed

2. **Created new skillref package** (~65 lines total):
   - `sdk/go/skillref/skillref.go` - `Platform()` helper
   - `sdk/go/skillref/doc.go` - Package documentation

3. **Updated agent package**:
   - Changed `Skills []skill.Skill` → `SkillRefs []*apiresource.ApiResourceReference`
   - Replaced `AddSkill()` → `AddSkillRef()`, `AddSkillRefs()`

4. **Updated subagent package**:
   - Changed to use `[]*apiresource.ApiResourceReference` directly

---

## Available Next Tasks

Choose ONE of these for the next session:

### Quick Wins (~15-30 min each)

| ID | Task | Lines | Description |
|----|------|-------|-------------|
| **1.2** | Assess VolumeMount/PortMapping | ~50 | Check if internal types can use generated types directly |

### Medium Tasks (~1 hour each)

| ID | Task | Lines | Description |
|----|------|-------|-------------|
| **3** | Fix codegen FromProto | ~200 | Fix generator to emit complete FromProto for arrays/maps |
| **4** | Standardize validation | ~100 | Extract common validation to shared package |

### Larger Tasks (~1-2 hours)

| ID | Task | Lines | Description |
|----|------|-------|-------------|
| **2** | Migrate subagent to struct args | ~150 | Replace functional options with InlineArgs struct |

### Final Tasks (after all above)

| ID | Task | Lines | Description |
|----|------|-------|-------------|
| **5a** | Fix tests | ~300 | Update all test files to new APIs |
| **5b** | Fix examples | ~200 | Update all 19 examples |
| **5c** | Fix documentation | ~100 | Update doc.go, README, api-reference |

---

## Comprehensive Analysis (Preserved)

### Package Status Summary

| Package | API Pattern | Status | Issues |
|---------|------------|--------|--------|
| `agent` | Struct args | Good | Tests reference old `AddSkill()` method |
| `workflow` | Struct args | Good | Docs reference removed `WithCatchTyped` |
| `environment` | Struct args | Good | Tests use non-existent functional options |
| `mcpserver` | Struct args | **FIXED** | ~~options.go deleted~~ |
| `subagent` | Functional opts | **NEEDS MIGRATION** | Inconsistent with rest of SDK |
| `skillref` | Functions | Good | New package, simple helpers |

### Generated Code Gaps (18 TODOs)

**File**: `sdk/go/gen/types/agentic_types.go`

Incomplete `FromProto()` implementations:
- Array fields: `Args`, `Volumes`, `Ports`, `EnabledTools`, `McpServers`, `SkillRefs`, `Signals`, `Do`
- Map fields: `Data`, `McpToolSelections`
- Float fields: `Temperature`

**File**: `sdk/go/gen/workflow/*.go`
- `trytaskconfig.go:87` - array field Try
- `switchtaskconfig.go:62` - array field Cases
- `fortaskconfig.go:86` - array field Do
- `forktaskconfig.go:75` - array field Branches

**Root cause**: Code generator doesn't handle these types.

### Validation Duplication

| Location | Check | Pattern |
|----------|-------|---------|
| `agent/validation.go:103-133` | Instructions min 10 chars | `ValidationError` struct |
| `subagent/subagent.go:256-258` | Instructions min 10 chars | `fmt.Errorf()` |
| `agent/validation.go` | Name regex | `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` |
| `workflow/validation.go` | Task name regex | `^[a-zA-Z0-9_-]+$` |

**Recommendation**: Extract to `sdk/go/internal/validation/`

### Test Files Needing Updates

| File | Issue |
|------|-------|
| `mcpserver/mcpserver_test.go` | Uses deleted functional options |
| `environment/environment_test.go` | Uses functional options that don't exist |
| `subagent/subagent_test.go` | Will need update after Phase 2 |
| `agent/agent_builder_test.go` | References `AddSkill()` instead of `AddSkillRef()` |
| `integration_scenarios_test.go` | Multiple old API usages |

### Example Files Needing Updates

- `examples/03_agent_with_mcp_servers.go` - Uses old mcpserver API
- `examples/04_agent_with_subagents.go` - Uses old subagent API
- `examples/05_agent_with_environment_variables.go` - Uses old APIs
- `examples/12_agent_with_typed_context.go` - Uses old APIs
- ... and 15 more examples

### TODOs Found in Codebase

| Location | TODO |
|----------|------|
| `agent/annotations.go:13` | Read SDK version from file/build |
| `workflow/annotations.go:13` | Read SDK version from file/build |
| `subagent/subagent.go:225-232` | `Organization()` returns empty string |

---

## Files Modified This Project

```
DELETED: sdk/go/skill/ (7 files, -896 lines)
DELETED: sdk/go/gen/skill/skillspec_args.go (-17 lines)
DELETED: sdk/go/mcpserver/options.go (-337 lines)
CREATED: sdk/go/skillref/skillref.go (~35 lines)
CREATED: sdk/go/skillref/doc.go (~30 lines)
MODIFIED: sdk/go/agent/agent.go (Skills → SkillRefs)
MODIFIED: sdk/go/agent/proto.go (removed convertSkillsToRefs)
MODIFIED: sdk/go/subagent/subagent.go (proto types)
MODIFIED: sdk/go/stigmer/context.go (removed skill registration)

Net: -1,366 lines (massive simplification)
```

---

## Uncommitted Changes

**Status**: Code modified but NOT committed

```
13 files changed, -1,366 lines net
Build: PASSES
Tests: FAILING (need updates to new APIs)
```

---

## Quick Resume

To continue this project:
```
@_projects/2026-01/20260125.03.sdk-codegen-review-and-improvements/next-task.md
```

Then choose from "Available Next Tasks" section above.

---

## Design Decisions Made

| Decision | Rationale |
|----------|-----------|
| Proto-first approach | Use proto types directly, thin helpers only |
| Skills are external | SDK references skills via `skillref`, doesn't create them |
| Struct args pattern | Pulumi-aligned, consistent across all SDK packages |
| Delete dead code first | Clean foundation before fixing tests |

---

## Key Principles

1. **Small units of work** - Complete one task fully before next
2. **Update this file** - Track progress after each task
3. **Build must pass** - Verify after each change
4. **Tests come last** - Fix foundations first
