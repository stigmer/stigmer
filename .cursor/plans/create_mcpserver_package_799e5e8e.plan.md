---
name: Create mcpserver Package
overview: Create the new `sdk/go/mcpserver/` package following the exact pattern established by the `skill` package, with the key difference that MCP servers do NOT support versioning.
todos:
  - id: create-mcpserver-go
    content: Create sdk/go/mcpserver/mcpserver.go with New(), Parse(), MustParse() functions
    status: completed
  - id: create-errors-go
    content: Create sdk/go/mcpserver/errors.go with sentinel errors and ParseError type
    status: completed
  - id: create-doc-go
    content: Create sdk/go/mcpserver/doc.go with comprehensive package documentation
    status: completed
  - id: create-tests
    content: Create sdk/go/mcpserver/mcpserver_test.go with full test coverage
    status: completed
  - id: verify-build
    content: "Verify build: go build ./mcpserver/..."
    status: completed
  - id: verify-tests
    content: "Verify tests: go test -v ./mcpserver/..."
    status: completed
isProject: false
---

# Create mcpserver Package (Sub-Task 2)

## Context

This is Phase 2, Sub-Task 2 of the API Resource Scope Redesign project. The goal is to create a clean, intuitive `mcpserver` package that replaces the deprecated `mcpserverref` package. This follows the exact pattern established in Sub-Task 1 with the `skill` package.

**Key Design Decision**: MCP servers do NOT support versioning (unlike Skills). This simplifies the API - no `WithVersion()` option, no `@version` suffix in parsing.

## Reference Implementation

The `skill` package created in Sub-Task 1 serves as the template:

- [sdk/go/skill/skill.go](sdk/go/skill/skill.go) - Main implementation
- [sdk/go/skill/errors.go](sdk/go/skill/errors.go) - Error types
- [sdk/go/skill/doc.go](sdk/go/skill/doc.go) - Package documentation
- [sdk/go/skill/skill_test.go](sdk/go/skill/skill_test.go) - Test coverage

## Implementation

### 1. Create `sdk/go/mcpserver/mcpserver.go`

Core functions following the `skill` pattern:

```go
package mcpserver

import (
    "strings"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// New creates an MCP server reference with explicit org and slug.
func New(org, slug string) *apiresource.ApiResourceReference {
    return &apiresource.ApiResourceReference{
        Org:  org,
        Kind: apiresourcekind.ApiResourceKind_mcp_server,
        Slug: slug,
    }
}

// Parse parses an MCP server reference string in "org/slug" format.
func Parse(ref string) (*apiresource.ApiResourceReference, error)

// MustParse is like Parse but panics if invalid.
func MustParse(ref string) *apiresource.ApiResourceReference
```

**Key Differences from `skill`:**

- No `opts ...Option` parameter on `New()` (no versioning)
- No `WithVersion()` option
- Parse only handles "org/slug" format (not "org/slug@version")
- Uses `ApiResourceKind_mcp_server` (44) instead of `ApiResourceKind_skill` (43)

### 2. Create `sdk/go/mcpserver/errors.go`

Same pattern as skill/errors.go:

```go
package mcpserver

var (
    ErrInvalidFormat = errors.New("invalid MCP server reference format")
    ErrEmptyOrg      = errors.New("organization cannot be empty")
    ErrEmptySlug     = errors.New("slug cannot be empty")
)

type ParseError struct {
    Input   string
    Message string
    Err     error
}

func (e *ParseError) Error() string { ... }
func (e *ParseError) Unwrap() error { return e.Err }
```

### 3. Create `sdk/go/mcpserver/doc.go`

Package documentation explaining:

- MCP servers are org-scoped resources (no versioning)
- Reference format: "org/slug" only
- Three creation methods: `New()`, `Parse()`, `MustParse()`
- Usage with agents via `agent.UseMCPServer()`

### 4. Create `sdk/go/mcpserver/mcpserver_test.go`

Test coverage (adapted from skill_test.go, removing version tests):

- **TestNew**: Basic org/slug creation
- **TestParse**: Valid formats, error cases
  - Valid: "stigmer/github", "acme-corp/internal-tools"
  - Invalid: empty, no slash, empty org, empty slug
- **TestMustParse**: Valid input, panic on invalid
- **TestParseError**: Error message formatting, Unwrap behavior
- **TestKindIsMcpServer**: Verify all methods return correct Kind

## Test Matrix


| Test Case              | Input                         | Expected                 |
| ---------------------- | ----------------------------- | ------------------------ |
| New with org/slug      | `New("stigmer", "github")`    | org=stigmer, slug=github |
| Parse full ref         | `Parse("stigmer/github")`     | org=stigmer, slug=github |
| Parse empty            | `Parse("")`                   | ErrInvalidFormat         |
| Parse no slash         | `Parse("just-slug")`          | ErrInvalidFormat         |
| Parse empty org        | `Parse("/slug")`              | ErrEmptyOrg              |
| Parse empty slug       | `Parse("org/")`               | ErrEmptySlug             |
| Parse multiple slashes | `Parse("org/slug/extra")`     | org=org, slug=slug/extra |
| MustParse valid        | `MustParse("stigmer/github")` | success                  |
| MustParse invalid      | `MustParse("")`               | panic                    |


## Verification

After implementation:

1. **Build verification**:
  ```bash
   cd sdk/go && go build ./mcpserver/...
  ```
2. **Test verification**:
  ```bash
   cd sdk/go && go test -v ./mcpserver/...
  ```
3. **Lint check**:
  - Use ReadLints tool on all new files

## File Structure

```
sdk/go/mcpserver/
    mcpserver.go      (~80 lines - simpler than skill.go, no versioning)
    errors.go         (~45 lines - same as skill/errors.go)
    doc.go            (~45 lines - adapted for MCP servers)
    mcpserver_test.go (~220 lines - skill tests minus version cases)
```

## Quality Checklist

- Consistent error messages (prefix with "mcpserver:" instead of "skill:")
- Comprehensive godoc on all exported functions
- Table-driven tests with clear test case names
- Edge case handling (multiple slashes, empty parts)
- No dependencies on deprecated `Scope` field
- Uses `apiresourcekind.ApiResourceKind_mcp_server` constant

