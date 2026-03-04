---
name: Inline Streaming UX Fixes
overview: "Fix four visual issues in the CLI inline streaming renderer: duplicate tool rendering during streaming, missing AI text bullet prefix, tools not on fresh lines, and incorrect approval separator placement."
todos:
  - id: fix-1-inplace-replace
    content: Add lastOutputWasRunning tracking to inlineRenderer; modify statusf, flushData, renderToolRunning, renderToolCompleted for in-place running-to-completed replacement
    status: completed
  - id: fix-2-remove-tool-calls
    content: Remove renderToolCalls calls from renderAIStreamEnd and renderAIMessage; optionally remove the function itself
    status: completed
  - id: fix-3-ai-bullet
    content: Change agentPrefix to return plain bullet; add prefix to renderAIMessage
    status: completed
  - id: fix-4-stream-closure
    content: Add finishAIStreamIfNeeded before general-case flush in handleEvent and at top of flushPendingReads
    status: completed
  - id: fix-5-approval-borders
    content: Restructure buildExpandedView and initPreApprovalStreaming to place separators above/below tool content
    status: completed
  - id: tests-update
    content: Update test assertions for AI bullet prefix, removed renderToolCalls, new approval layout, and in-place replacement
    status: completed
isProject: false
---

# Inline Streaming UX Fixes

## Problem Analysis (from screenshots)

Four distinct issues visible in the `stigmer draft mcp-server` flow:

1. **Tool duplication**: `renderToolRunning` prints `● List() …`, then `renderToolCompleted` prints `● List(.)\n    1 entry` -- the running line is never erased. Additionally, `renderToolCalls` in `AIStreamEndEvent` may render a third copy using the legacy `Render()` format.
2. **No AI text bullet**: AI messages like "The workspace entries are listed..." appear without any visual marker. Claude Code prefixes these with `●`.
3. **Tools on same line as AI text**: `renderToolCalls` writes to stderr immediately after AI text goes to stdout with `\n\n` -- stream timing causes concatenation on the same terminal line.
4. **Wrong approval borders**: Separators are placed header/sep/content/sep, but should be sep/header+content/sep to frame the tool between separators, with the question in the footer below.

---

## Fix 1: In-Place Running-to-Completed Replacement

**Root cause**: `renderToolCompleted` never erases the preceding running indicator line.

**Files**: [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)

**Approach**: Add a `lastOutputWasRunning bool` flag to `inlineRenderer` that tracks whether the most recent stderr write was a running indicator. When `renderToolCompleted` fires for the same tool ID and no other output has been written in between, erase the running line first.

- Add `lastOutputWasRunning bool` field to `inlineRenderer`
- In `statusf()` -- clear the flag (any status output invalidates erasure):

```go
func (r *inlineRenderer) statusf(format string, args ...interface{}) {
    r.lastOutputWasRunning = false
    fmt.Fprintf(r.cfg.status, format, args...)
    r.flushWriter(r.cfg.status)
}
```

- In `flushData()` -- clear the flag (AI output also invalidates):

```go
func (r *inlineRenderer) flushData() {
    r.lastOutputWasRunning = false
    r.flushWriter(r.cfg.data)
}
```

- In `renderToolRunning` -- set the flag AFTER `statusf` (which clears it):

```go
func (r *inlineRenderer) renderToolRunning(e executiontui.ToolRunningEvent) {
    line := toolrender.RenderCompactRunning(e.ToolCall, r.compactOpts)
    if e.SubAgentID != "" {
        line = toolrender.GutterWrap(line)
    }
    r.statusf("%s\n", line)
    r.lastOutputWasRunning = true  // set AFTER statusf
    r.lastRenderedRunningID = e.ToolCallID
}
```

- In `renderToolCompleted` -- conditionally erase:

```go
func (r *inlineRenderer) renderToolCompleted(e executiontui.ToolCompletedEvent) {
    if r.lastOutputWasRunning && r.lastRenderedRunningID == e.ToolCallID &&
        termctl.IsSupported(r.cfg.status) {
        termctl.EraseLines(r.cfg.status, 1)
    }
    line := toolrender.RenderCompact(e.ToolCall, r.compactOpts)
    // ... rest unchanged
}
```

**Parallel-tool edge case**: When multiple tools run concurrently (A running -> B running -> A completed), `lastRenderedRunningID` points to B, so A's completion doesn't attempt erasure -- safe fallback to showing both lines. This is acceptable since parallel tool calls are uncommon and the result is merely a cosmetic duplicate, not incorrect output.

---

## Fix 2: Remove Legacy `renderToolCalls`

**Root cause**: `renderToolCalls` uses the legacy `toolrender.Render()` (two-space label format) and fires from `AIStreamEndEvent` / `AIMessageEvent`, producing a third rendering of each tool. This also causes the "not on fresh line" issue via dual-stream write timing.

**Files**: [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)

- Remove the `renderToolCalls` calls from `renderAIStreamEnd` and `renderAIMessage`:

```go
func (r *inlineRenderer) renderAIStreamEnd(e executiontui.AIStreamEndEvent) {
    // ... existing content output + "\n\n" ...
    // REMOVE: if len(e.ToolCalls) > 0 { r.renderToolCalls(e.ToolCalls) }
}

func (r *inlineRenderer) renderAIMessage(e executiontui.AIMessageEvent) {
    // ... existing content output ...
    // REMOVE: if len(e.ToolCalls) > 0 { r.renderToolCalls(e.ToolCalls) }
}
```

- The `renderToolCalls` function itself can be removed or kept as dead code for now.

**Safety**: Every tool call in the AI message generates its own `ToolRunningEvent` and `ToolCompletedEvent` from the backend. Removing `renderToolCalls` means tools are rendered exclusively by their event handlers -- which is the intended path for compact rendering.

---

## Fix 3: AI Text Bullet Prefix

**Root cause**: `agentPrefix()` returns `""`. AI messages have no visual marker distinguishing them from tool output.

**Files**: [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)

- Change `agentPrefix` to return a plain `●`  character (no ANSI styling -- keeps piped stdout clean):

```go
func (r *inlineRenderer) agentPrefix(subAgentID string) string {
    if subAgentID != "" {
        return ""
    }
    return "● "
}
```

- Add the prefix to `renderAIMessage` (currently only `renderAIStreamStart` uses it):

```go
func (r *inlineRenderer) renderAIMessage(e executiontui.AIMessageEvent) {
    r.finishAIStreamIfNeeded()
    if e.Content != "" {
        prefix := r.agentPrefix(e.SubAgentID)
        fmt.Fprintf(r.cfg.data, "%s%s\n\n", prefix, formatNonTUIAIText(e.Content))
        r.flushData()
    }
}
```

**Result**: Matches Claude Code's visual language -- `● Here are the files and folders...`

---

## Fix 4: Defensive AI Stream Closure

**Root cause**: If a tool event ever arrives while an AI stream is still open on stdout, the tool output on stderr concatenates on the same terminal line. While the API normally delivers `AIStreamEndEvent` before tool events, adding a safety net prevents edge-case timing bugs.

**Files**: [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)

- Add `finishAIStreamIfNeeded()` before the general-case flush in `handleEvent` (line ~265):

```go
r.finishAIStreamIfNeeded()
r.flushPendingReads()
```

- Also add `finishAIStreamIfNeeded()` at the top of `flushPendingReads` when there are pending reads:

```go
func (r *inlineRenderer) flushPendingReads() {
    if len(r.pendingReads) == 0 {
        return
    }
    r.finishAIStreamIfNeeded()
    // ... rest unchanged
}
```

---

## Fix 5: Approval Separator Placement

**Root cause**: `buildExpandedView` places separators as `header / sep / content / sep`. The desired layout (matching Claude Code) frames the tool between separators: `sep / header + content / sep`, with the question and menu in the "footer" below.

**Files**:

- [run_stream_inline_approval.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go) -- `buildExpandedView`
- [run_stream_inline_streaming.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming.go) -- `initPreApprovalStreaming`

### Current vs desired layout

```
CURRENT                          DESIRED
● Execute(cat ...)               ────────────────────────
────────────────────────         ● Execute(cat ...)
cat /full/command/text           ────────────────────────
────────────────────────         Do you want to execute...?
Do you want to execute...?         > Yes / Skip / Reject
  > Yes / Skip / Reject
```

### Changes to `buildExpandedView`

```go
func (r *inlineRenderer) buildExpandedView(tc toolrender.ToolCallInfo) string {
    var b strings.Builder
    sep := toolrender.ApprovalSeparator()

    b.WriteString(sep)           // top separator
    b.WriteByte('\n')

    header := toolrender.ExpandedApprovalHeader(tc, r.compactOpts)
    b.WriteString(header)
    b.WriteByte('\n')

    content := toolrender.ExpandedApprovalContent(tc)
    if content != "" {
        b.WriteString(content)
        if !strings.HasSuffix(content, "\n") {
            b.WriteByte('\n')
        }
    }

    b.WriteString(sep)           // bottom separator
    b.WriteByte('\n')

    return b.String()
}
```

### Changes to `initPreApprovalStreaming`

Same reordering -- top separator before header:

```go
sep := toolrender.ApprovalSeparator()
header := toolrender.ExpandedApprovalHeader(e.ToolCall, r.compactOpts)
output := sep + "\n" + header + "\n"
```

The bottom separator is already added by `prepareApprovalDisplay` when `contentStreamed=true` -- no change needed there.

---

## Test Updates

Tests in these files will need assertion updates:

- [run_stream_inline_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_test.go) -- AI message assertions now expect `●`  prefix; tool call rendering from AI events removed
- [run_stream_inline_approval_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_approval_test.go) -- separator placement assertions
- [run_stream_inline_streaming_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming_test.go) -- pre-approval streaming header assertions
- [render_compact_test.go](client-apps/cli/pkg/toolrender/render_compact_test.go) -- likely unchanged (compact rendering itself doesn't change)

---

## Design Decisions

- **Plain `●`  without ANSI styling** for AI prefix: keeps piped stdout clean. The terminal's default text color renders it naturally.
- **In-place replacement over suppression**: Users still see the running indicator (`● List(src/) …`) for feedback while the tool runs. When completed, it's cleanly replaced. Suppressing running indicators entirely would lose that feedback.
- **No `renderToolCalls` removal fallback**: The backend guarantees `ToolRunningEvent`/`ToolCompletedEvent` for every tool call. The legacy path from AI messages is redundant and causes format inconsistency (legacy `Render()` vs compact `RenderCompact()`).

