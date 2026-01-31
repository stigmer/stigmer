---
name: SubAgent Smart Parsing
overview: Implement smart org/slug parsing for SubAgent with dual API (panic/error), thread safety, and comprehensive tests - maintaining architectural consistency with Agent while respecting SubAgent's distinct semantics (no org field, explicit references only).
todos:
  - id: errors-file
    content: Create sdk/go/subagent/errors.go with sentinel errors and RefParseError type
    status: completed
  - id: skill-options-file
    content: Create sdk/go/subagent/skill_options.go with SkillOption and AtVersion
    status: completed
  - id: parsing-file
    content: Create sdk/go/subagent/parsing.go with parseSkillRef (explicit org/slug only)
    status: completed
  - id: update-subagent
    content: "Update subagent.go: add mutex, AddSkill/AddSkills, TryAddSkill/TryAddSkills, update existing methods for thread safety"
    status: completed
  - id: test-file
    content: Create sdk/go/subagent/smart_parsing_test.go with comprehensive test coverage
    status: completed
  - id: verification
    content: Run go build, go test -v, and go test -race to verify implementation
    status: completed
isProject: false
---

# SubAgent Smart Parsing Implementation

## Context and Constraints

SubAgent differs fundamentally from Agent in one critical way: **SubAgents have no `Org` field**. They are defined inline within parent agents and don't inherit org context. This means:

- **Slug-only references are NOT supported** - `AddSkill("web-search")` must error
- **Only explicit `org/slug` format** - `AddSkill("stigmer/web-search")` works
- Version support via string (`@version`) or `AtVersion()` option

## Architecture Decision: Code Organization

**Why NOT share parsing with agent package:**

- Agent imports subagent (for `subagent.SubAgent` type)
- Importing agent into subagent would create circular dependency
- Error messages should be context-specific (`subagent: ...` vs `agent: ...`)
- SubAgent semantics are distinct (no defaultOrg fallback)

**Decision:** Self-contained implementation in subagent package with mirrored API patterns.

## API Design

```go
// Panic API (builder pattern for static code)
sub.AddSkill("stigmer/web-search")
sub.AddSkill("stigmer/web-search@v1.0")
sub.AddSkill("stigmer/web-search", AtVersion("v1.0"))
sub.AddSkills("stigmer/skill-a", "acme/skill-b")

// Error API (dynamic input handling)
sub, err := sub.TryAddSkill("user-input")
sub, err := sub.TryAddSkills(configSlice...)
```

## File Structure

```
sdk/go/subagent/
├── subagent.go           # Modified: add mutex, new methods
├── skill_options.go      # New: SkillOption, AtVersion
├── errors.go             # New: sentinel errors, RefParseError
├── parsing.go            # New: parseSkillRef (explicit org only)
└── smart_parsing_test.go # New: comprehensive test suite
```

---

## Implementation Details

### File 1: `sdk/go/subagent/errors.go`

Sentinel errors and structured error type for parsing failures:

```go
var (
    ErrEmptyRef  = errors.New("reference string is empty")
    ErrEmptyOrg  = errors.New("organization is empty in reference")
    ErrEmptySlug = errors.New("slug is empty in reference")
    ErrOrgRequired = errors.New("explicit org/slug format required (subagents have no org context)")
)

type RefParseError struct {
    Ref     string  // Original input
    Message string  // Human-readable explanation
    Err     error   // Underlying sentinel error
}
```

### File 2: `sdk/go/subagent/skill_options.go`

Functional options pattern (mirrors agent but independent type):

```go
type SkillOption func(*skillOptions)

func AtVersion(v string) SkillOption
func applySkillOptions(opts ...SkillOption) *skillOptions
```

### File 3: `sdk/go/subagent/parsing.go`

Smart parsing that requires explicit `org/slug`:

```go
func parseSkillRef(ref string, opts ...SkillOption) (*apiresource.ApiResourceReference, error)
```

Key parsing rules:

- `"org/slug"` - Valid, extracts org and slug
- `"org/slug@v1.0"` - Valid, extracts version from string
- `"org/slug"` + `AtVersion("v1.0")` - Option overrides string version
- `"slug-only"` - **Error** with ErrOrgRequired (no slash detected)
- `""` - Error with ErrEmptyRef
- `"/slug"` - Error with ErrEmptyOrg
- `"org/"` - Error with ErrEmptySlug

### File 4: Updates to `sdk/go/subagent/subagent.go`

**Add mutex for thread safety** (align with Agent):

```go
type SubAgent struct {
    // ... existing fields ...
    mu sync.Mutex  // NEW: protects skillRefs and mcpAccess
}
```

**New smart parsing methods:**

- `AddSkill(ref string, opts ...SkillOption) *SubAgent` - Panic on error
- `AddSkills(refs ...string) *SubAgent` - Batch, panic on first error
- `TryAddSkill(ref string, opts ...SkillOption) (*SubAgent, error)` - Returns error
- `TryAddSkills(refs ...string) (*SubAgent, error)` - Atomic batch with error

**Update existing methods to use mutex:**

- `GrantMcpAccess` - Add lock/unlock
- `AddSkillRef` - Add lock/unlock
- `AddSkillRefs` - Add lock/unlock
- `AddOrgSkillRef` - Add lock/unlock

### File 5: `sdk/go/subagent/smart_parsing_test.go`

Comprehensive test coverage following agent's test patterns:


| Test Category    | Coverage                                                 |
| ---------------- | -------------------------------------------------------- |
| AddSkill success | org/slug, org/slug@version, with AtVersion option        |
| AddSkill errors  | slug-only (ErrOrgRequired), empty, empty org, empty slug |
| TryAddSkill      | Success and error paths with proper error typing         |
| AddSkills        | Multiple refs, empty list no-op, atomic failure          |
| TryAddSkills     | Success, atomic failure on invalid                       |
| Chaining         | Method chaining returns same SubAgent                    |
| Thread safety    | Concurrent access with 100 goroutines                    |
| RefParseError    | Error message formatting, Unwrap behavior                |


---

## Key Design Decisions


| Decision          | Choice                          | Rationale                                                      |
| ----------------- | ------------------------------- | -------------------------------------------------------------- |
| Slug-only support | Reject with clear error         | SubAgents have no org context; explicit refs prevent ambiguity |
| Thread safety     | Add mutex                       | Consistency with Agent; safe concurrent usage                  |
| Option pattern    | Self-contained SkillOption type | Avoid circular import; clean API                               |
| Error handling    | Dual API (panic/Try*)           | Builder pattern for static, error handling for dynamic         |
| Atomic operations | Parse all before modify         | Fail-fast, no partial state on error                           |


---

## Quality Checklist

- All methods are thread-safe (mutex protected)
- Error messages include context (`subagent: cannot parse "x": ...`)
- Chaining works correctly (returns `*SubAgent`)
- Atomic operations (batch methods don't partially succeed)
- Test coverage > 95% (success, error, edge cases)
- Documentation with examples on all public methods
- Consistent with Agent API patterns

---

## Verification Commands

After implementation:

```bash
# Build verification
go build ./sdk/go/subagent/...

# Test with verbose output
go test -v ./sdk/go/subagent/...

# Check for race conditions
go test -race ./sdk/go/subagent/...
```

