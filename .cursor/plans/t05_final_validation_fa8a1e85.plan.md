---
name: T05 Final Validation
overview: Final validation and close-out for the MCP server shared abstractions + codegen project. The branch is functional (all tests pass), but the review uncovered concrete quality gaps that need to be addressed before this can be considered production-ready for a world-class platform.
todos:
  - id: resolve-govet
    content: Resolve go vet / struct tag escaping decision (collaborative discussion)
    status: completed
  - id: resolve-duplication
    content: Resolve shared type duplication decision (collaborative discussion)
    status: completed
  - id: convert-tests
    content: Add tests for internal/convert/ (GenerateSlug, VisibilityFromString)
    status: completed
  - id: mcpserver-toproto-tests
    content: Add ToProto() conversion tests for gen/mcpserver/
    status: completed
  - id: workflow-toproto-tests
    content: Add ToProto() conversion tests for gen/workflow/
    status: completed
  - id: implement-govet-fix
    content: Implement go vet fix in codegen + regenerate (based on decision)
    status: completed
  - id: final-verification
    content: Run go test, go vet, go build — all clean
    status: completed
  - id: close-out
    content: Update next-task.md, write session checkpoint
    status: completed
isProject: false
---

# T05: Final Validation and Close-Out

## Review Findings

All 29 test files pass with `-race`. No TODO/FIXME/HACK comments found. Clean architecture. But the review surfaced **5 concrete issues** ranging from a quality-gate blocker to missing test coverage.

---

## Issue 1: `go vet` fails on all generated code (27 warnings)

`go vet ./...` exits non-zero due to struct tag syntax warnings in all 3 generated packages (`gen/agent/`, `gen/mcpserver/`, `gen/workflow/`).

**Root cause:** The codegen escapes commas in jsonschema struct tag descriptions (`\,`), which is what the `jsonschema-go` library requires — but `go vet`'s `structtag` checker flags `\,` as "bad syntax for struct tag value".

**Impact:** `go vet` cannot be used in CI, which is a significant quality-gate gap. This effectively means no static analysis on the generated code or any package that transitively imports it.

**Source:** `[tools/codegen/generator/mcp.go](tools/codegen/generator/mcp.go)` line 315:

```go
desc = strings.ReplaceAll(desc, ",", "\\,")
```

**Decision needed:** This is an architectural tradeoff worth discussing. Options:

- **A)** Strip commas from generated descriptions entirely (replace with semicolons) — clean `go vet`, slightly degraded LLM-facing descriptions
- **B)** Accept the `go vet` warnings as a known limitation of the `jsonschema-go` convention — add a note in the Makefile/CI
- **C)** Move descriptions out of struct tags into a separate schema registration — clean `go vet`, bigger refactor, but arguably cleaner separation
- **D)** Investigate `go vet -json` + filtering to suppress only the `structtag` check for generated files in CI

## Issue 2: Shared types duplicated 3x across generated packages

`EnvironmentValue`, `EnvironmentInput`, and their `toProto()` methods are copy-pasted identically in `gen/agent/`, `gen/mcpserver/`, and `gen/workflow/`.

**Current state:** Each gen package is fully self-contained (no cross-package imports). The Makefile regenerates all 3 in one shot.

**Decision needed:** Is this acceptable for now (simpler, no coupling between gen packages), or should shared types be extracted into a common generated package (e.g., `gen/common/`)? Extracting would reduce duplication but add a dependency between generated packages.

## Issue 3: Zero test coverage for `internal/convert/`

`[mcp-server/internal/convert/convert.go](mcp-server/internal/convert/convert.go)` has two functions used by all generated `ToProto()` methods:

- `GenerateSlug()` — slug generation from human-readable names
- `VisibilityFromString()` — string-to-enum conversion

Both are critical and untested. This is straightforward to fix.

## Issue 4: No `ToProto()` conversion tests for mcpserver and workflow

The agent domain has comprehensive conversion tests (`[agents/convert_test.go](mcp-server/internal/domains/agents/convert_test.go)`, 425 lines), but `gen/mcpserver/` and `gen/workflow/` have zero test coverage. Since these `ToProto()` methods are called from the apply handlers — getting proto conversion wrong means silently corrupting data sent to the backend.

## Issue 5: Dirty working tree has unrelated changes

The working tree has uncommitted changes from a different project (`stigmer-planton-integration`) plus tracked binaries (`generator`, `proto2schema`). These should not be included in any T05 commits.

---

## Proposed Execution Plan

### Step 1: Resolve the `go vet` / struct tag decision (collaborative)

Present findings, pick an approach together.

### Step 2: Resolve the shared type duplication decision (collaborative)

Discuss and decide whether to extract common types or keep the current self-contained approach.

### Step 3: Add `internal/convert/` tests

Write table-driven tests for `GenerateSlug` and `VisibilityFromString` covering edge cases (empty strings, special characters, unicode, case sensitivity).

### Step 4: Add `ToProto()` conversion tests for mcpserver and workflow

Follow the established pattern from `[agents/convert_test.go](mcp-server/internal/domains/agents/convert_test.go)` — test full round-trip conversion for all field types including oneofs, nested structs, maps, and slices.

### Step 5: Implement `go vet` fix (based on Step 1 decision)

If we're fixing the codegen, update `[mcp.go](tools/codegen/generator/mcp.go)`, regenerate all 3 domains, verify `go vet` passes clean.

### Step 6: Final verification

- `go test -race ./...` green
- `go vet ./...` clean (or documented exception)
- `go build ./...` clean
- Confirm no regressions in tool behavior

### Step 7: Update project tracking and close out

Update `next-task.md` to mark T05 complete. Write session checkpoint.