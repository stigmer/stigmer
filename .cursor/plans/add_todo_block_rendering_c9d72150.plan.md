---
name: Add Todo Block Rendering
overview: Add a blockTodo type to blocks.go and rendering functions to render_blocks.go, following the established block/rendering patterns. This is a pure types-and-rendering task — no model state, no event handler, no bridge wiring.
todos:
  - id: block-type
    content: Add blockTodo const and newTodoBlock constructor to blocks.go
    status: completed
  - id: render-fns
    content: Add todoStatusIcon, sortTodosForDisplay, renderTodoPreview, renderTodoExpanded to render_blocks.go
    status: completed
  - id: tests
    content: Add tests for all new functions in render_blocks_test.go
    status: completed
  - id: build-verify
    content: Run go build and go test to confirm everything compiles and passes
    status: completed
isProject: false
---

# Task 2: Add Todo Block Type and Rendering

## Scope

Two files only: [blocks.go](client-apps/cli/pkg/executiontui/blocks.go) and [render_blocks.go](client-apps/cli/pkg/executiontui/render_blocks.go), plus tests in [render_blocks_test.go](client-apps/cli/pkg/executiontui/render_blocks_test.go).

Explicitly **not in scope**: model fields (`todoBlockIdx`), event handler logic, bridge/stream wiring. Those are Tasks 3-5.

## Design Decisions

### 1. Expandable, starts expanded

The todo block is **expandable** (can be collapsed) and **defaults to expanded**. This differs from tool blocks which start collapsed. Rationale: the purpose of showing todos is progress visibility during execution. Starting collapsed hides the value. Users can collapse manually if the list is long.

The collapsed preview shows a single-line summary; the expanded view shows all items with status indicators.

### 2. Status icons

Plain Unicode characters that are visually distinct without needing ANSI color:

- `"in_progress"` -- `●` (filled circle, draws the eye)
- `"pending"` -- `○` (open circle, clearly "not started")
- `"completed"` -- `✓` (consistent with tool `StateBadge("completed")`)
- `"cancelled"` -- `─` (dash, struck-through feel)
- unknown -- `?` (defensive fallback)

### 3. Display-order sorting (stable)

The renderer sorts items by status group using `sort.SliceStable` to preserve the agent's creation order within each group:

1. `in_progress` (weight 0) -- current focus, top
2. `pending` (weight 1) -- upcoming
3. `completed` (weight 2) -- done, pushed down
4. `cancelled` (weight 3) -- dismissed, bottom

### 4. Dimming completed/cancelled items

Completed and cancelled item **content text** is rendered with `dimStyle` (color "8"), matching the convention used for metadata throughout the codebase. The gutter and icon remain at normal brightness so the status is still scannable.

### 5. Gutter border

Uses `"     │ "` (5 spaces + bar + space), the same visual pattern as `renderStreamingTool` and `toolrender`'s file preview blocks. Defined as a local constant `todoGutter` for clarity in the item-rendering loop.

## Visual Examples

**Collapsed (with focus + expand indicator from `decorateExpandableBlock`):**

```
▸ 📋 Tasks (2/5 done) ▶
```

**Expanded:**

```
  📋 Tasks (2/5 done) ▼
     │ ● Implement login endpoint
     │ ○ Add password hashing
     │ ○ Write tests
     │ ✓ Set up authentication module
     │ ✓ Add user model
```

(Note: in-progress and pending items are full brightness; completed items have dimmed content text.)

## Changes

### [blocks.go](client-apps/cli/pkg/executiontui/blocks.go)

**Add `blockTodo` to the `blockType` const block** (after `blockError`):

```go
blockTodo // Agent todo/planning items
```

**Add constructor:**

```go
func newTodoBlock(preview, full string) contentBlock {
    return contentBlock{
        blockType:  blockTodo,
        expandable: true,
        expanded:   true,
        preview:    preview,
        full:       full,
    }
}
```

No new fields on `contentBlock`. The block uses the existing `preview`/`full`/`expandable`/`expanded` fields. No `toolCall`, `toolCallID`, or `toolState` -- those are tool-specific.

### [render_blocks.go](client-apps/cli/pkg/executiontui/render_blocks.go)

**Add constant:**

```go
const todoGutter = "     │ "
```

**Add `todoStatusIcon`:**

```go
func todoStatusIcon(status string) string {
    switch status {
    case "in_progress":
        return "●"
    case "pending":
        return "○"
    case "completed":
        return "✓"
    case "cancelled":
        return "─"
    default:
        return "?"
    }
}
```

**Add `sortTodosForDisplay`:**

Uses `sort.SliceStable` with a status-weight map. Returns a new slice (does not mutate input).

```go
func sortTodosForDisplay(todos []TodoItem) []TodoItem {
    sorted := make([]TodoItem, len(todos))
    copy(sorted, todos)
    sort.SliceStable(sorted, func(i, j int) bool {
        return todoStatusWeight(sorted[i].Status) < todoStatusWeight(sorted[j].Status)
    })
    return sorted
}

func todoStatusWeight(status string) int {
    switch status {
    case "in_progress":
        return 0
    case "pending":
        return 1
    case "completed":
        return 2
    case "cancelled":
        return 3
    default:
        return 4
    }
}
```

**Add `renderTodoPreview`:**

```go
func renderTodoPreview(todos []TodoItem) string {
    completed := 0
    for _, t := range todos {
        if t.Status == "completed" {
            completed++
        }
    }
    return fmt.Sprintf("📋 Tasks (%d/%d done)", completed, len(todos))
}
```

**Add `renderTodoExpanded`:**

```go
func renderTodoExpanded(todos []TodoItem) string {
    header := renderTodoPreview(todos)
    if len(todos) == 0 {
        return header
    }
    sorted := sortTodosForDisplay(todos)
    var lines []string
    for _, item := range sorted {
        icon := todoStatusIcon(item.Status)
        gutter := dimStyle.Render(todoGutter)
        content := item.Content
        if item.Status == "completed" || item.Status == "cancelled" {
            content = dimStyle.Render(content)
        }
        lines = append(lines, gutter+icon+" "+content)
    }
    return header + "\n" + strings.Join(lines, "\n")
}
```

### No changes to `renderedBlockText`

The existing generic pipeline (`displayContent()` -> `decorateExpandableBlock()` -> `indentSubAgentBlock()`) handles todo blocks without modification. The block type enum is not dispatched on in the rendering path.

## Tests

Add to [render_blocks_test.go](client-apps/cli/pkg/executiontui/render_blocks_test.go):

- `TestTodoStatusIcon` -- verify all 4 statuses + unknown fallback
- `TestSortTodosForDisplay` -- verify in_progress before pending before completed before cancelled, stable within groups
- `TestRenderTodoPreview` -- verify header format with counts
- `TestRenderTodoExpanded` -- verify header + sorted gutter-bordered items
- `TestRenderTodoExpanded_EmptyList` -- verify graceful handling
- `TestRenderTodoExpanded_DimmedCompleted` -- verify completed items use dim styling
- `TestNewTodoBlock_StartsExpanded` -- verify constructor sets `expanded: true`

## Known Trade-off: Scroll Position

The todo block is positioned where the first `TodoUpdateEvent` is received (inline in the block list). Subsequent updates modify it in-place (Task 4 responsibility). If many blocks are appended after the todo block, the user must scroll up to see updated progress. This is consistent with how running tool blocks work. A "pin to top" feature could be added later if warranted -- it would require non-trivial changes to the block ordering system.

## Build Verification

After all changes, `go build ./client-apps/cli/...` and `go test ./client-apps/cli/pkg/executiontui/...` must pass.