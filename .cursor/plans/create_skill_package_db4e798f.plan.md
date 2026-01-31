---
name: Create skill package
overview: Create the new `skill` package at `sdk/go/skill/` with New(), Parse(), MustParse() functions, structured errors, comprehensive tests, and documentation.
todos:
  - id: create-skill-go
    content: Create sdk/go/skill/skill.go with New(), Parse(), MustParse() and Option type
    status: completed
  - id: create-errors-go
    content: Create sdk/go/skill/errors.go with ErrInvalidFormat, ErrEmptyOrg, ErrEmptySlug, ParseError
    status: completed
  - id: create-doc-go
    content: Create sdk/go/skill/doc.go with comprehensive package documentation
    status: completed
  - id: create-test-go
    content: Create sdk/go/skill/skill_test.go with full test coverage
    status: completed
  - id: create-build-bazel
    content: Create sdk/go/skill/BUILD.bazel for Bazel build
    status: cancelled
  - id: verify-build
    content: Run go build and go test to verify implementation
    status: completed
isProject: false
---

# Sub-Task 1: Create `skill` Package

## Context

This is Phase 2 of the API Resource Scope Redesign project. Phase 1 (proto changes) is complete - the `ApiResourceReference` now requires `org` and has removed the `Scope` field (reserved at position 5).

The new `skill` package will provide an intuitive API for creating skill references using the `org/slug` model.

## Key Files

**Reference files (existing patterns):**

- `[sdk/go/skillref/skillref.go](sdk/go/skillref/skillref.go)` - Current implementation (to be replaced later)
- `[sdk/go/mcpserverref/mcpserverref.go](sdk/go/mcpserverref/mcpserverref.go)` - Similar pattern
- `[sdk/go/agent/errors.go](sdk/go/agent/errors.go)` - Error patterns

**Proto definition:**

- `[apis/ai/stigmer/commons/apiresource/io.proto](apis/ai/stigmer/commons/apiresource/io.proto)` - `ApiResourceReference` message

## Implementation

### 1. Create `sdk/go/skill/skill.go`

```go
package skill

import (
    "strings"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

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

### 2. Create `sdk/go/skill/errors.go`

```go
var (
    ErrInvalidFormat = errors.New("invalid skill reference format")
    ErrEmptyOrg      = errors.New("organization cannot be empty")
    ErrEmptySlug     = errors.New("slug cannot be empty")
)

type ParseError struct {
    Input   string
    Message string
    Err     error
}
```

### 3. Create `sdk/go/skill/doc.go`

Package documentation with examples for `New()`, `Parse()`, and `MustParse()`.

### 4. Create `sdk/go/skill/skill_test.go`

Test cases covering:

- `New()` with org/slug
- `New()` with version option
- `Parse()` for valid formats: "org/slug", "org/slug@version"
- `Parse()` error cases: empty, no slash, empty org, empty slug
- `MustParse()` success and panic cases

### 5. Create `sdk/go/skill/BUILD.bazel`

Bazel build configuration with deps on apiresource stubs.

## Verification

After implementation:

1. `go build ./sdk/go/skill/...` - compiles without errors
2. `go test ./sdk/go/skill/...` - all tests pass
3. Run `bazel build //sdk/go/skill:all` to verify Bazel integration

## Out of Scope

This sub-task does NOT include:

- Modifying the agent package
- Updating existing call sites
- Removing the old `skillref` package

