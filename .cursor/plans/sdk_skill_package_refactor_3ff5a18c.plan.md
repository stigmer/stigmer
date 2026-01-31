---
name: SDK Skill Package Refactor
overview: Refactor SDK packages with intuitive naming (skill, mcpserver) and implement org/slug model in focused, testable increments.
todos:
  - id: subtask-1-skill-package
    content: "Sub-Task 1: Create skill package with New/Parse/MustParse, tests, and documentation"
    status: pending
  - id: subtask-2-mcpserver-package
    content: "Sub-Task 2: Create mcpserver package with New/Parse/MustParse, tests, and documentation"
    status: pending
  - id: subtask-3-agent-parsing
    content: "Sub-Task 3: Add AddSkill/AddSkills/UseMCPServer with smart parsing to agent package"
    status: pending
  - id: subtask-4-subagent-parsing
    content: "Sub-Task 4: Add AddSkill/AddSkills with smart parsing to subagent package"
    status: pending
  - id: subtask-5-migrate-examples
    content: "Sub-Task 5: Migrate all SDK examples to new API"
    status: pending
  - id: subtask-6-migrate-tests
    content: "Sub-Task 6: Migrate all SDK tests to new API"
    status: pending
  - id: subtask-7-update-docs
    content: "Sub-Task 7: Update SDK documentation (README, USAGE, API_REFERENCE, migration-guide)"
    status: pending
  - id: subtask-8-cleanup
    content: "Sub-Task 8: Remove deprecated skillref/mcpserverref packages and old methods"
    status: pending
isProject: false
---

# Phase 2: SDK Refactoring with Intuitive Naming

## Naming Philosophy

**Current (verbose, redundant):**

```go
import "github.com/stigmer/stigmer/sdk/go/skillref"
agent.AddSkillRef(skillref.Platform("web-search"))
```

**New (clean, intuitive):**

```go
import "github.com/stigmer/stigmer/sdk/go/skill"
agent.AddSkill("stigmer/web-search")
// or explicitly:
skill.New("stigmer", "web-search")
```

In SDK context, you're always working with references. The "ref" is implicit - no need to state the obvious.

---

## Package Renames


| Current        | New         | Rationale                                          |
| -------------- | ----------- | -------------------------------------------------- |
| `skillref`     | `skill`     | "Adding a skill" is natural; reference is implicit |
| `mcpserverref` | `mcpserver` | Same principle                                     |


---

## Sub-Tasks (45-90 min each)

### Sub-Task 1: Create `skill` Package (Foundation)

**Scope:** Create the new `skill` package with core functions, without touching existing code.

**Deliverables:**

- New package at `sdk/go/skill/`
- `skill.go`: `New()`, `Parse()`, `MustParse()` functions
- `doc.go`: Comprehensive package documentation
- `skill_test.go`: Full test coverage
- `errors.go`: Structured error types

**Does NOT include:** Modifying agent package, updating call sites, removing old package.

**Estimated time:** 60-75 minutes

---

### Sub-Task 2: Create `mcpserver` Package (Foundation)

**Scope:** Create the new `mcpserver` package with core functions.

**Deliverables:**

- New package at `sdk/go/mcpserver/`
- `mcpserver.go`: `New()`, `Parse()`, `MustParse()` functions
- `doc.go`: Comprehensive package documentation
- `mcpserver_test.go`: Full test coverage
- `errors.go`: Structured error types

**Does NOT include:** Modifying agent package, updating call sites, removing old package.

**Estimated time:** 45-60 minutes

---

### Sub-Task 3: Add Smart Parsing to Agent Package

**Scope:** Add new `AddSkill()` and `UseMCPServer()` methods with smart org/slug parsing.

**Deliverables:**

- New methods in `agent.go`: `AddSkill()`, `AddSkills()`, updated `UseMCPServer()`
- Internal parsing helpers (slug-only vs org/slug detection)
- Tests in `agent_skill_parsing_test.go`
- Keep old methods temporarily (no breaking changes yet)

**Does NOT include:** Updating existing call sites, removing old methods.

**Estimated time:** 75-90 minutes

---

### Sub-Task 4: Add Smart Parsing to SubAgent Package

**Scope:** Add new skill methods to SubAgent with smart parsing.

**Deliverables:**

- New methods in `subagent.go`: `AddSkill()`, `AddSkills()`
- Tests in `subagent_skill_parsing_test.go`
- Keep old methods temporarily

**Does NOT include:** Updating existing call sites.

**Estimated time:** 45-60 minutes

---

### Sub-Task 5: Migrate SDK Examples

**Scope:** Update all SDK examples to use new API.

**Deliverables:**

- Update 6 example files to use `skill.New()` / `skill.Parse()` / `agent.AddSkill()`
- Update imports from `skillref` → `skill`, `mcpserverref` → `mcpserver`
- Verify examples compile and run

**Files:**

- `sdk/go/examples/02_agent_with_skills.go`
- `sdk/go/examples/03_agent_with_mcp_servers.go`
- `sdk/go/examples/04_agent_with_subagents.go`
- `sdk/go/examples/05_agent_with_environment_variables.go`
- `sdk/go/examples/06_agent_with_inline_content.go`
- `sdk/go/examples/12_agent_with_typed_context.go`

**Estimated time:** 45-60 minutes

---

### Sub-Task 6: Migrate SDK Tests

**Scope:** Update all SDK test files to use new API.

**Deliverables:**

- Update ~10 test files
- Verify all tests pass

**Files:**

- `sdk/go/agent/agent_builder_test.go`
- `sdk/go/agent/agent_skills_test.go`
- `sdk/go/agent/agent_subagents_test.go`
- `sdk/go/agent/proto_integration_test.go`
- `sdk/go/agent/error_cases_test.go`
- `sdk/go/agent/edge_cases_test.go`
- `sdk/go/agent/benchmarks_test.go`
- `sdk/go/stigmer/context_test.go`
- `sdk/go/integration_scenarios_test.go`

**Estimated time:** 60-75 minutes

---

### Sub-Task 7: Update SDK Documentation

**Scope:** Update all SDK documentation to reflect new API.

**Deliverables:**

- Update `sdk/go/README.md`
- Update `sdk/go/docs/USAGE.md`
- Update `sdk/go/docs/API_REFERENCE.md`
- Update `sdk/go/docs/guides/migration-guide.md`

**Estimated time:** 45-60 minutes

---

### Sub-Task 8: Remove Deprecated Code

**Scope:** Remove old packages and deprecated methods.

**Deliverables:**

- Delete `sdk/go/skillref/` directory
- Delete `sdk/go/mcpserverref/` directory
- Remove deprecated methods from agent/subagent packages
- Update BUILD.bazel files
- Final verification: `go build ./...` and `go test ./...`

**Estimated time:** 45-60 minutes

---

## Sub-Task 1 Implementation Details

Since we'll start with Sub-Task 1, here's the detailed specification:

### File: `sdk/go/skill/skill.go`

```go
// Package skill provides helpers for creating skill references in agent definitions.
//
// When building agents, you add skills to give them specialized knowledge.
// Skills are managed separately (via CLI: stigmer skill push) - this package
// creates references to those skills.
//
// Reference Format:
//   - "org/slug" - Full reference (e.g., "stigmer/web-search")
//   - "org/slug@version" - With version (e.g., "stigmer/web-search@v1.0")
//
// Examples:
//
//   // Create a skill reference
//   ref := skill.New("stigmer", "web-search")
//   ref := skill.New("stigmer", "web-search", skill.WithVersion("v1.0"))
//
//   // Parse from string
//   ref, err := skill.Parse("stigmer/web-search@v1.0")
//
//   // In agent context (using agent.AddSkill for smart parsing)
//   agent.AddSkill("stigmer/web-search")
//   agent.AddSkill("my-skill")  // Uses agent.Org
package skill
```

### Public API

```go
// New creates a skill reference with explicit org and slug.
func New(org, slug string, opts ...Option) *apiresource.ApiResourceReference

// Parse parses "org/slug" or "org/slug@version" format.
func Parse(ref string) (*apiresource.ApiResourceReference, error)

// MustParse is like Parse but panics on error.
func MustParse(ref string) *apiresource.ApiResourceReference

// Option configures skill reference creation.
type Option func(*options)

// WithVersion sets the skill version.
func WithVersion(v string) Option
```

### Error Types

```go
var (
    ErrInvalidFormat = errors.New("invalid skill reference format")
    ErrEmptyOrg      = errors.New("organization cannot be empty")
    ErrEmptySlug     = errors.New("slug cannot be empty")
)

// ParseError provides detailed context for parsing failures.
type ParseError struct {
    Input   string
    Message string
    Err     error
}
```

### Test Coverage


| Test Case          | Input                                     | Expected                     |
| ------------------ | ----------------------------------------- | ---------------------------- |
| New with org/slug  | `New("stigmer", "web-search")`            | org=stigmer, slug=web-search |
| New with version   | `New("stigmer", "ws", WithVersion("v1"))` | version=v1                   |
| Parse full ref     | `Parse("stigmer/web-search")`             | org=stigmer, slug=web-search |
| Parse with version | `Parse("stigmer/web-search@v1.0")`        | version=v1.0                 |
| Parse empty        | `Parse("")`                               | ErrInvalidFormat             |
| Parse no slash     | `Parse("just-slug")`                      | ErrInvalidFormat             |
| Parse empty org    | `Parse("/slug")`                          | ErrEmptyOrg                  |
| Parse empty slug   | `Parse("org/")`                           | ErrEmptySlug                 |
| MustParse valid    | `MustParse("stigmer/ws")`                 | success                      |
| MustParse invalid  | `MustParse("")`                           | panic                        |


---

## Verification Checkpoints

After each sub-task:

1. `go build ./sdk/go/...` - compiles without errors
2. `go test ./sdk/go/...` - all tests pass
3. Code review for quality, documentation, edge cases

---

## Success Criteria

- Clean, intuitive package names (`skill`, `mcpserver`)
- Smart parsing: `"slug"` uses agent.Org, `"org/slug"` is explicit
- No `Scope` field references anywhere
- All tests pass
- Documentation updated
- Zero technical debt

