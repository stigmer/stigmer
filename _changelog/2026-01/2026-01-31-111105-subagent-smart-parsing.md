# SubAgent Smart Parsing API - Explicit Org/Slug References

**Date**: January 31, 2026

## Summary

Implemented smart org/slug parsing for the SubAgent package, completing Phase 2, Sub-Task 4 of the SDK skill package refactor. SubAgents now support intuitive `AddSkill("org/slug")` and `AddSkill("org/slug@version")` APIs with dual panic/error handling patterns, full thread safety, and comprehensive test coverage. Unlike the Agent package, SubAgent requires explicit org/slug format (no slug-only references) because SubAgents have no org context.

## Problem Statement

SubAgents needed modern smart parsing APIs to match the Agent package, but with distinct semantics reflecting their architectural role as inline sub-components without organizational context.

### Pain Points

- **No smart parsing**: SubAgents required verbose `AddSkillRef()` calls with manual struct construction
- **Inconsistent API**: Agent had smart parsing (`AddSkill("slug")`), SubAgent did not
- **Missing thread safety**: SubAgent methods lacked mutex protection for concurrent access
- **Poor error handling**: No Try* variants for dynamic input validation
- **Semantic differences not enforced**: Agent supports slug-only refs via `agent.Org`, but SubAgent has no org field - this distinction wasn't clear in the API

## Solution

Created a self-contained smart parsing implementation in the SubAgent package with:

1. **Smart org/slug parsing** - Parses `"org/slug"` and `"org/slug@version"` formats
2. **Dual API pattern** - Panic methods for builder pattern, Try* methods for dynamic input
3. **Thread safety** - All mutating methods use mutex protection
4. **Atomic batch operations** - `AddSkills` fails fast with no partial state on error
5. **Explicit-only semantics** - Slug-only references (`"web-search"`) return `ErrOrgRequired`

### Architecture Decision: Self-Contained Implementation

**Why NOT share parsing with agent package:**
- Agent imports subagent (for `subagent.SubAgent` type) - importing agent into subagent creates circular dependency
- Error messages should be context-specific (`subagent: ...` vs `agent: ...`)
- SubAgent semantics are distinct - no defaultOrg fallback, explicit refs only
- Independent evolution - changes to one don't affect the other

## Implementation Details

### Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `sdk/go/subagent/errors.go` | 71 | Sentinel errors (`ErrOrgRequired`, `ErrEmptyRef`, `ErrEmptyOrg`, `ErrEmptySlug`) and `RefParseError` type with Unwrap support |
| `sdk/go/subagent/skill_options.go` | 45 | `SkillOption` functional option type and `AtVersion(v)` configuration function |
| `sdk/go/subagent/parsing.go` | 98 | `parseSkillRef(ref, opts...)` function requiring explicit org/slug format |
| `sdk/go/subagent/smart_parsing_test.go` | 621 | 28 comprehensive tests covering success paths, error cases, edge cases, thread safety |

### Files Modified

| File | Changes |
|------|---------|
| `sdk/go/subagent/subagent.go` | Added `mu sync.Mutex`, new smart parsing methods (`AddSkill`, `AddSkills`, `TryAddSkill`, `TryAddSkills`), updated existing methods for thread safety (+181 lines) |
| `sdk/go/subagent/subagent_test.go` | Fixed references to removed `Scope` field from Phase 1 proto changes |

### New API Methods

**Panic API (builder pattern for static code):**
```go
sub.AddSkill("stigmer/web-search")
sub.AddSkill("stigmer/web-search@v1.0")
sub.AddSkill("stigmer/web-search", AtVersion("v1.0"))
sub.AddSkills("stigmer/skill-a", "acme/skill-b")
```

**Error API (for dynamic/user input):**
```go
sub, err := sub.TryAddSkill(userInput)
sub, err := sub.TryAddSkills(configSlice...)
```

### Parsing Rules

| Input | Result |
|-------|--------|
| `"org/slug"` | ✅ Parses to org="org", slug="slug" |
| `"org/slug@v1.0"` | ✅ Extracts version from string |
| `"org/slug"` + `AtVersion("v2.0")` | ✅ Option overrides string version |
| `"slug-only"` (no `/`) | ❌ `ErrOrgRequired` - SubAgents have no org context |
| `""` | ❌ `ErrEmptyRef` |
| `"/slug"` | ❌ `ErrEmptyOrg` |
| `"org/"` | ❌ `ErrEmptySlug` |

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Slug-only support | **Reject with clear error** | SubAgents have no org context; explicit refs prevent ambiguity |
| Thread safety | **Add mutex to SubAgent struct** | Consistency with Agent package; safe concurrent usage |
| Option pattern | **Self-contained SkillOption type** | Avoid circular import; clean API independent of agent package |
| Error handling | **Dual API (panic/Try\*)** | Builder pattern for static code, error handling for dynamic input |
| Atomic operations | **Parse all before modify** | Fail-fast, no partial state on error in batch operations |

## Testing

### Coverage

- **28 tests** covering all new functionality
- **Success paths**: org/slug parsing, versioning, options, chaining
- **Error paths**: empty inputs, slug-only rejection, atomic batch failures
- **Edge cases**: unicode, long strings, version special chars, nested slugs
- **Thread safety**: 100 goroutines concurrent access verified

### Verification Results

```bash
✅ go build ./sdk/go/subagent/...           # Passed
✅ go test -v ./sdk/go/subagent/...         # 28/28 tests passed
✅ go test -race ./sdk/go/subagent/...      # Race detector passed
✅ No linter errors
```

## Benefits

### Developer Experience

**Before:**
```go
sub.AddSkillRef(&apiresource.ApiResourceReference{
    Kind:    apiresourcekind.ApiResourceKind_skill,
    Org:     "stigmer",
    Slug:    "web-search",
    Version: "v1.0",
})
```

**After:**
```go
sub.AddSkill("stigmer/web-search@v1.0")
// or with option
sub.AddSkill("stigmer/web-search", AtVersion("v1.0"))
```

### Safety Improvements

- **Type safety**: Compile-time method chaining validation
- **Thread safety**: Concurrent goroutines can safely modify SubAgent
- **Atomic operations**: Batch operations never leave partial state
- **Clear errors**: `RefParseError` provides context for debugging

## Impact

### Affected Components

- **SDK developers**: Can now use modern API for SubAgent skill configuration
- **SubAgent builders**: Simplified skill reference syntax
- **Future refactoring**: Completes Phase 2 Sub-Task 4, enables migration to new API (Sub-Tasks 5-8)

### API Consistency

- Agent and SubAgent now have parallel smart parsing APIs
- Semantic differences (slug-only vs explicit-only) are enforced at runtime
- Documentation clearly explains why SubAgent requires explicit org/slug

### Next Steps (Phase 2 Remaining)

- **Sub-Task 5**: Migrate SDK examples to new API (6 files)
- **Sub-Task 6**: Migrate SDK tests to new API (~10 files)
- **Sub-Task 7**: Update SDK documentation (README, USAGE, API_REFERENCE, migration guide)
- **Sub-Task 8**: Remove deprecated `skillref`/`mcpserverref` packages

## Related Work

- **2026-01-31-103512-sdk-mcpserver-package.md** - Phase 2 Sub-Task 2: Created mcpserver package
- **2026-01-31-105400-agent-smart-parsing-api.md** - Phase 2 Sub-Task 3: Agent smart parsing implementation
- **.cursor/plans/sdk_skill_package_refactor_3ff5a18c.plan.md** - Overall Phase 2 plan
- **_projects/2026-01/20260130.01.api-resource-scope-redesign/** - Parent project

---

**Status**: ✅ Production Ready
**Timeline**: ~2.5 hours implementation + testing
**Phase Progress**: Phase 2, Sub-Task 4/8 complete
