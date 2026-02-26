---
name: Table Rendering Modernization
overview: Create a shared Table renderer in pkg/display/, migrate all list/collection table rendering to use it (session, execution, search, apply), consolidate 6 duplicate truncateString() copies to the existing Unicode-aware utility, and standardize empty-state handling.
todos:
  - id: create-table-type
    content: Create `pkg/display/tablerender.go` with `Table` type, `NewTable`, `AddRow`, `Render`, `IsEmpty`, and `WithHeaderColor`/`WithAdaptive` options. Write comprehensive tests in `tablerender_test.go`. Update `BUILD.bazel`.
    status: completed
  - id: migrate-session-list
    content: Migrate `session/display.go` `displayListTable` to use `display.Table`. Replace hardcoded `fmt.Printf("%-26s ...")` with dynamic-width colored table. Delete local `truncateString`.
    status: completed
  - id: migrate-execution-list
    content: Migrate `execution/display.go` `displayListTable` to use `display.Table`. Same pattern as session. Delete local `truncateString`.
    status: completed
  - id: migrate-search-table
    content: Replace local `renderTable()` in `search/display.go` with `display.Table`. Delete the local function. Verify search output is unchanged.
    status: completed
  - id: migrate-apply-table
    content: Refactor `table.go` `renderAdaptiveTable()` to use `display.Table` with `WithAdaptive()` internally. Delete the local function and `min()` helper.
    status: completed
  - id: consolidate-truncate
    content: Replace remaining 4 local `truncateString()` copies (agent, workflow, project, skill) with `display.TruncateWithEllipsis()`. Delete all local copies. Update BUILD.bazel deps.
    status: completed
  - id: standardize-empty-state
    content: Move `DisplayEmptyResults` from `search/display.go` to `pkg/display/`. Update session/execution to use the shared function. Update search to call it from the new location.
    status: completed
isProject: false
---

# Item 4: List/Table Rendering Modernization

## Problem Statement

The CLI has **four different table rendering implementations** with inconsistent behavior:

1. `**search/display.go:renderTable()`** -- Dynamic column widths, color headers, ANSI-aware measurement. No terminal-width adaptation.
2. `**table.go:renderAdaptiveTable()`** -- Dynamic widths + terminal-width adaptation with smart column shrinking. Private, coupled to `ApplyResultTable`.
3. `**session/display.go:displayListTable()`** -- Hardcoded `fmt.Printf("%-26s ...")`. No dynamic widths, no colors, no terminal awareness.
4. `**execution/display.go:displayListTable()**` -- Same hardcoded approach as session.

Additionally, **6 identical copies** of a byte-based `truncateString()` function exist across display.go files, all silently broken for non-ASCII input. The correct Unicode-aware version (`TruncateWithEllipsis`) already exists in `pkg/display/truncate.go`.

## Scope Decisions (from architectural analysis)

- **In scope**: List/collection table rendering only (session list, execution list, search results table, apply results table)
- **Out of scope**: Get/detail views (key-value display for single resources) -- different presentation pattern, not tables
- **In scope**: `truncateString()` consolidation -- correctness bug, not cosmetic cleanup

## Architecture: Shared `Table` Type

Create a `Table` struct in `[pkg/display/](client-apps/cli/pkg/display/)` that combines the best of the existing implementations.

### API Design

```go
// pkg/display/tablerender.go

type Table struct { /* unexported fields */ }

func NewTable(headers []string, opts ...TableOption) *Table
func (t *Table) AddRow(cells ...string)
func (t *Table) Render(w io.Writer)
func (t *Table) IsEmpty() bool

type TableOption func(*Table)

func WithHeaderColor(fn func(...interface{}) string) TableOption
func WithAdaptive() TableOption
```

### Rendering behavior (merged from best of existing)

- Dynamic column widths via `MeasureColorizedString()` (from `colors.go`)
- Color-aware padding via `PadRight()` (from `colors.go`)
- Color-aware trimming via `TrimColorizedString()` when adaptive shrinks columns
- Consistent 3-space column gap
- Separator: `---` dashes (matching search's current style -- note: `table.go` uses `───` box-drawing chars; I recommend staying with ASCII dashes for broader terminal compatibility unless you prefer the box-drawing style)
- `WithAdaptive()`: enables terminal-width adaptation with proportional shrinking of the widest columns first (generalized from `renderAdaptiveTable`'s last-column-first heuristic, which was specific to the apply table's ID column)
- `Render(w io.Writer)` for testability (callers pass `os.Stdout` in production, `bytes.Buffer` in tests)
- The table renders **only** headers, separator, and rows. Spacing before/after is the caller's responsibility (composability).

### Why this API shape

- `**io.Writer` on `Render`**, not on `NewTable`: The table is a data structure you build incrementally; the output destination is a rendering concern, not a construction concern.
- **Functional options over builder methods**: Avoids fluent-chain ambiguity about which calls are config vs action. Options are set once at construction.
- `**AddRow` takes variadic strings**: Matches how callers build rows today (extract fields, pass as args). No need for a `Row` type.
- **No embedded empty-state or pagination**: Those are caller-level concerns with different data needs. The table just renders what it's given.

## Files Changed

### New files

- `[pkg/display/tablerender.go](client-apps/cli/pkg/display/tablerender.go)` -- `Table` type, options, rendering logic (~120 lines)
- `[pkg/display/tablerender_test.go](client-apps/cli/pkg/display/tablerender_test.go)` -- Tests for empty, single-row, multi-row, ANSI cells, adaptive shrinking (~150 lines)

### Modified files

**Session + Execution (primary migration targets)**:

- `[internal/cli/session/display.go](client-apps/cli/internal/cli/session/display.go)` -- Replace `displayListTable` with `Table`, delete `truncateString`
- `[internal/cli/execution/display.go](client-apps/cli/internal/cli/execution/display.go)` -- Replace `displayListTable` with `Table`, delete `truncateString`

**Search (consolidation -- delete local `renderTable`)**:

- `[internal/cli/search/display.go](client-apps/cli/internal/cli/search/display.go)` -- Replace local `renderTable()` with `display.Table`

**ApplyResultTable (consolidation -- delete local `renderAdaptiveTable`)**:

- `[pkg/display/table.go](client-apps/cli/pkg/display/table.go)` -- Replace `renderAdaptiveTable()` with `Table` internally

**truncateString consolidation (6 files)**:

- `[internal/cli/agent/display.go](client-apps/cli/internal/cli/agent/display.go)` -- Replace local `truncateString` with `display.TruncateWithEllipsis`
- `[internal/cli/workflow/display.go](client-apps/cli/internal/cli/workflow/display.go)` -- Same
- `[internal/cli/project/display.go](client-apps/cli/internal/cli/project/display.go)` -- Same
- `[internal/cli/skill/display.go](client-apps/cli/internal/cli/skill/display.go)` -- Same
- `[internal/cli/session/display.go](client-apps/cli/internal/cli/session/display.go)` -- Same (already touched above)
- `[internal/cli/execution/display.go](client-apps/cli/internal/cli/execution/display.go)` -- Same (already touched above)

**Empty-state standardization**:

- Move `DisplayEmptyResults()` from `search/display.go` to `pkg/display/` so session/execution can use it without importing the `search` package

**BUILD.bazel updates**: `pkg/display/BUILD.bazel` (add new source + test), plus any internal packages that need `display` dep added

## Discovered Issue: Pagination Bug

Session and execution pagination hardcodes `"Page 1 of %d"` regardless of which page was actually requested. The search package's `DisplayPaginationInfo(page, totalPages, totalCount)` correctly shows the actual page and provides a "Use --page N" hint. Fixing this would require changing `DisplayListResult` signatures to accept the current page number. I will **not** fix this in this plan -- it's a separate bug that touches the command-handler call chain. Flagging it here for future work.

## Execution Strategy

The work is sequenced so each step is independently testable and committable. Steps 1-3 are the core value. Steps 4-5 are consolidation of existing working code. Step 6 is the truncateString correctness fix. Step 7 is empty-state cleanup.

At each step: `go build`, `go vet`, `go test ./...` must pass before proceeding.