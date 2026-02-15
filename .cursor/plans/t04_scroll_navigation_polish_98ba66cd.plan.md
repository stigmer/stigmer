---
name: T04 Scroll Navigation Polish
overview: "Implement intelligent scroll behavior for the execution TUI: auto-scroll pause/resume driven by viewport position, g/G navigation keys, scroll-into-view when Tab-focusing off-screen blocks, and a footer indicator for scroll-paused state."
todos:
  - id: extract-helper
    content: Extract renderedBlockText helper from rebuildViewportContent in render_blocks.go
    status: completed
  - id: scroll-file
    content: Create scroll.go with blockStartLine and scrollFocusedBlockIntoView
    status: completed
  - id: update-keys
    content: Add g/G key handlers and autoScroll management in update.go
    status: completed
  - id: footer-indicator
    content: Add scroll-paused footer indicator in view.go
    status: completed
  - id: scroll-into-view
    content: Wire scrollFocusedBlockIntoView into Tab/Shift+Tab handlers
    status: completed
  - id: tests
    content: "Write tests: scroll pause/resume, g/G keys, scroll-into-view, blockStartLine"
    status: completed
  - id: build-verify
    content: Run build, vet, and all tests to verify no regressions
    status: completed
isProject: false
---

# T04: Scroll Pause, Navigation, and Scroll-Into-View

## Design Decisions (for your review)

### 1. No separate `scrollPaused` field -- reuse existing `autoScroll`

The `next-task.md` suggested adding a `scrollPaused` bool to the Model. However, the Model already has an `autoScroll` field (defaults to `true`, never currently set to `false`). Since `scrollPaused` is the exact inverse of `autoScroll`, maintaining two booleans would be redundant and a bug surface. I propose using `autoScroll` alone:

- `autoScroll = true` -- viewport follows new content (current behavior)
- `autoScroll = false` -- scroll paused, viewport stays put

### 2. `autoScroll` driven by `viewport.AtBottom()` after every scroll event

After the viewport processes any scroll-related key or message, we set:

```go
m.autoScroll = m.viewport.AtBottom()
```

This one line handles all cases automatically:

- User scrolls up -> not at bottom -> `autoScroll = false`
- User scrolls back down to bottom -> at bottom -> `autoScroll = true`
- Content fits in viewport -> `AtBottom()` always true -> `autoScroll` stays true

This is much cleaner than tracking scroll direction or counting manual scroll events.

**Verified from bubbles v0.20.0 source**: `AtBottom()` returns `m.YOffset >= max(0, len(m.lines)-m.Height)`. When content fits the viewport, `maxYOffset` is 0 and `YOffset` is 0, so `AtBottom()` is always true. No false positives.

### 3. `SetContent` preserves scroll position (confirmed)

**Verified from bubbles v0.20.0 source**: `SetContent()` only adjusts `YOffset` if it's past the new content length (calls `GotoBottom()`). Otherwise, `YOffset` is preserved. This means when new content arrives while the user has scrolled up, their position is naturally preserved without any special handling.

### 4. `g`/`G` keys handled by us, not the viewport

The bubbles viewport's `DefaultKeyMap` does NOT include `g`/`G` bindings. We intercept them in `handleKeyPress` before forwarding to the viewport:

- `g`: calls `viewport.GotoTop()`, sets `autoScroll = false`
- `G`: calls `viewport.GotoBottom()`, sets `autoScroll = true`

### 5. Scroll-into-view via `blockStartLine` computation

When Tab/Shift+Tab moves focus to an off-screen block, we need to scroll the viewport to make it visible. This requires knowing the line offset of the focused block in the viewport content.

**Approach**: A pure function `blockStartLine(blocks, focusedIdx, targetIdx)` computes the starting line by iterating blocks and counting rendered lines. To avoid logic duplication with `rebuildViewportContent`, both functions will share a new `renderedBlockText(block, blockIdx, focusedIdx)` helper extracted from the render loop.

### 6. Footer indicator design

When `autoScroll` is false and execution is not done, replace the `"up-down scroll"` hint with a pause indicator:

- **Not paused, expandable**:   `up-down scroll  Tab focus  Enter expand  q quit`
- **Paused, expandable**:   `down Paused - G resume  Tab focus  Enter expand  q quit`
- **Paused, no expandable**:   `down Paused - G resume  q quit`
- **Approval active**: unchanged (approval takes precedence)

This reuses the same horizontal space rather than making the footer wider.

## Verified Technical Facts

- `viewport.SetContent()` preserves `YOffset` unless past end (then clamps via `GotoBottom`) -- confirmed from [source](https://github.com/charmbracelet/bubbles/blob/v0.20.0/viewport/viewport.go)
- `viewport.SetYOffset(n)` clamps to `[0, maxYOffset]` -- safe to call with any value
- `viewport.AtBottom()` handles edge cases: short content returns true, empty content returns true
- Default KeyMap: up/down (k/j), pgup/pgdn (b/f/space), half-page (u/d) -- no g/G
- Mouse scroll is NOT enabled (no `tea.WithMouseCellMotion()`) -- not in T04 scope

## File Changes

### 1. NEW: `pkg/executiontui/scroll.go` (~60-70 lines)

Scroll management helpers, isolated per SRP:

- `scrollFocusedBlockIntoView(m *Model)` -- adjusts viewport `YOffset` so the focused block is visible. Uses `blockStartLine` to find the line, then checks if it's above or below the viewport bounds.
- `blockStartLine(blocks []contentBlock, focusedIdx, targetIdx int) int` -- computes the starting line number of a block in the viewport content by counting rendered lines before it. Uses `renderedBlockText` for consistency with `rebuildViewportContent`.

### 2. MODIFY: `pkg/executiontui/render_blocks.go` (~+10 lines, 218 -> ~228)

Extract `renderedBlockText` from `rebuildViewportContent` to share with `blockStartLine`:

```go
// renderedBlockText returns the display text for a block, with decorations.
// Returns empty string for blocks that should be skipped.
func renderedBlockText(b contentBlock, blockIdx, focusedIdx int) string {
    text := b.displayContent()
    if text == "" {
        return ""
    }
    if b.expandable {
        text = decorateExpandableBlock(text, b.expanded, blockIdx == focusedIdx)
    }
    return text
}
```

Then `rebuildViewportContent` calls `renderedBlockText` instead of inlining that logic. The existing tests continue to pass unchanged.

### 3. MODIFY: `pkg/executiontui/update.go` (~+20 lines, 211 -> ~231)

Three changes:

**a) Add `g`/`G` key handlers** in `handleKeyPress`, after the focus/toggle block and before viewport forwarding:

```go
case "g":
    m.viewport.GotoTop()
    m.autoScroll = false
    return m, nil
case "G":
    m.viewport.GotoBottom()
    m.autoScroll = true
    return m, nil
```

**b) Update `autoScroll` after viewport scroll forwarding** (2 locations -- the explicit key handler fallthrough and the catch-all `Update` fallthrough):

```go
m.viewport, cmd = m.viewport.Update(msg)
m.autoScroll = m.viewport.AtBottom()
return m, cmd
```

**c) Add `scrollFocusedBlockIntoView` call** after Tab/Shift+Tab focus changes:

```go
case "tab":
    m.focusNextExpandable()
    m.refreshViewport()
    m.scrollFocusedBlockIntoView()
    m.autoScroll = m.viewport.AtBottom()
    return m, nil
```

### 4. MODIFY: `pkg/executiontui/view.go` (~+12 lines, 105 -> ~117)

Update `renderFooter` with a scroll-paused branch:

```go
func (m Model) renderFooter() string {
    var hints string
    if m.approval != nil {
        hints = "  [a] Approve  [s] Skip  [r] Reject  [q] Quit"
    } else if !m.autoScroll && !m.done {
        // Scroll paused indicator -- user scrolled away from bottom.
        if m.hasExpandableBlocks() {
            hints = "  ↓ Paused — G resume  Tab focus  Enter expand  q quit"
        } else {
            hints = "  ↓ Paused — G resume  q quit"
        }
    } else if m.hasExpandableBlocks() {
        hints = "  ↑↓ scroll  Tab focus  Enter expand  q quit"
    } else {
        hints = "  ↑↓ scroll  q quit"
    }
    // ... padding unchanged
}
```

### 5. MODIFY: `pkg/executiontui/update_test.go` (~+120-150 lines)

New test sections:

- **Scroll pause tests**: Simulate scroll-up key, verify `autoScroll` becomes false
- **Auto-resume tests**: Simulate scroll to bottom, verify `autoScroll` becomes true
- **g/G key tests**: Verify `GotoTop`/`GotoBottom` behavior and `autoScroll` state
- **New content while paused**: Add blocks while `autoScroll=false`, verify viewport does NOT jump to bottom
- **Scroll-into-view tests**: Tab to off-screen block, verify viewport adjusts

### 6. NEW: `pkg/executiontui/scroll_test.go` (~40-50 lines)

Unit tests for the pure `blockStartLine` function with various block configurations.

## File Size Compliance

- `update.go`: 211 + 20 = ~231 lines (under 250)
- `view.go`: 105 + 12 = ~117 lines (under 250)
- `render_blocks.go`: 218 + 10 = ~228 lines (under 250)
- `scroll.go`: ~60-70 lines (new, well under limit)
- `model.go`: unchanged at 114 lines

## What Could Go Wrong

- `**viewport.AtBottom()` edge case with expand/collapse**: When a block is expanded while autoScroll is true, `refreshViewport` calls `GotoBottom()`, keeping us at bottom. If a block above the viewport is expanded, content grows and the current position shifts. This is the expected behavior -- the viewport preserves `YOffset` and the visual content below shifts down. I believe this is correct but will verify in testing.
- **Timing of `autoScroll` check**: The viewport's `Update()` synchronously modifies `YOffset` and returns the new model, so `AtBottom()` on the returned model reflects the post-scroll state. Verified from source.

## Not In Scope

- Mouse scroll support (no mouse mode is enabled)
- Smooth scroll animation (bubbles viewport does instant jumps)
- Help overlay (`?` key) -- deferred to T06

