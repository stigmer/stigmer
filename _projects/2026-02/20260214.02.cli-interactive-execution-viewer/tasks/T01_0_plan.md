# Task T01: Architecture Design and Technical Plan

**Created**: 2026-02-14
**Status**: APPROVED
**Type**: Feature Development — Architecture & Design

> **Reviewed and approved on 2026-02-14.**

## Objective

Design the Bubbletea TUI architecture that will replace the current linear stdout-based `messageStreamRenderer` with a full interactive execution viewer. This task produces the architectural blueprint, component contracts, and phased implementation plan that all subsequent tasks will follow.

## Current Architecture (What We're Replacing)

### Data Flow Today

```
gRPC Subscribe (stream.Recv)
    ↓
streamAgentExecution() loop          — run_stream.go
    ↓
messageStreamRenderer.render()       — run_display_stream.go
    ↓
writeCompleteMessage() / printDelta()
    ↓
toolrender.Render(info)              — toolrender/render.go
    ↓
formatFileContentPreview()           — toolrender/file_preview.go
    ↓
fmt.Fprintln(os.Stdout)             — linear, one-way, non-interactive
```

### Key Files Being Replaced/Modified

| File | Current Role | Change |
|------|-------------|--------|
| `cmd/stigmer/root/run_stream.go` | gRPC stream loop, spinner management | Wire gRPC messages as `tea.Msg` into Bubbletea program |
| `cmd/stigmer/root/run_display_stream.go` | `messageStreamRenderer` — linear stdout writer | **Replace entirely** with Bubbletea model |
| `cmd/stigmer/root/run_display_tools.go` | `convertToolCall()` — proto to `ToolCallInfo` | Keep as-is, reuse from TUI model |
| `pkg/toolrender/render.go` | `Render()` — static string formatting | Extend with `RenderExpanded()` for full content |
| `pkg/toolrender/file_preview.go` | `formatFileContentPreview()` — 3-line truncation | Add `formatFileContentFull()` for expanded state |
| `pkg/approval/interactive.go` | Separate `tea.NewProgram` for approval | Integrate as sub-state in TUI model |
| `pkg/spinner/spinner.go` | Standalone spinner goroutine | Replace with Bubbletea spinner component |

### Current Limitations

1. Output is write-once to stdout — once scrolled past, cannot revisit
2. Tool call results truncated to 3 lines with no way to see more
3. Approval prompt is a separate Bubbletea program (launches, runs, returns)
4. Spinner runs as a goroutine with `\r\033[K` — fragile, conflicts with other output

## Proposed Architecture

### Bubbletea TUI Model

The TUI is a single Bubbletea program that manages all rendering during an agent execution. It uses **alt-screen mode** during execution (clean, full-terminal interactive experience), and prints a final summary to inline stdout after the user exits.

```
┌─────────────────────────────────────────────────────────┐
│  Execution: aex-01khebew38t20ndxva6nef0zkx              │
│  Phase: ▶️ Running                                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  🤖 Agent: I'll start by reading the input files...     │
│                                                         │
│  📖 Read: inputs/agent-api.proto (1.0 KB, 29 lines) ▶  │
│     │ syntax = "proto3";                                │
│     │                                                   │
│     │ package ai.stigmer.agentic.agent.v1;              │
│     ⋮ 26 more lines                                    │
│                                                         │
│▸ 📖 Read: inputs/agent-spec.proto (12 KB, 274 lines)▼  │ ← focused, expanded
│     │ syntax = "proto3";                                │
│     │                                                   │
│     │ package ai.stigmer.agentic.agent.v1;              │
│     │                                                   │
│     │ import "google/protobuf/timestamp.proto";         │
│     │ ... (all 274 lines)                               │
│                                                         │
│  📂 List: /workspace (97 chars, 3ms)                 ▶  │
│     inputs/, outputs/                                   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ ↑↓ scroll  Tab focus  Enter expand  q quit  ? help     │
└─────────────────────────────────────────────────────────┘
```

### Model Structure

```go
// executionTUI is the top-level Bubbletea model for the execution viewer.
type executionTUI struct {
    // --- Content ---
    blocks     []contentBlock  // ordered list of rendered content blocks
    
    // --- Viewport ---
    viewport   viewport.Model  // scrollable content area
    autoScroll bool            // follow new content at bottom
    
    // --- Focus ---
    focusIndex int             // index into blocks of the focused expandable block
                               // -1 when no block is focused
    
    // --- Execution state ---
    executionID string
    phase       string
    
    // --- Streaming ---
    streamingAI   bool         // AI message currently being streamed
    streamBuffer  string       // accumulated streaming text
    
    // --- Approval sub-state ---
    approvalActive bool
    approvalModel  approvalSubModel
    
    // --- Dimensions ---
    width  int
    height int
    
    // --- Communication ---
    sub    <-chan executionEvent  // channel from gRPC stream goroutine
}

// contentBlock represents one renderable unit in the execution output.
type contentBlock struct {
    blockType   blockType  // ai, toolCall, system, phaseChange
    
    // For display
    preview     string     // collapsed rendering (current 3-line preview)
    full        string     // expanded rendering (full tool result)
    
    // State
    expandable  bool       // all tool types support expand/collapse
    expanded    bool       // current state
}

type blockType int
const (
    blockAI blockType = iota
    blockToolCall
    blockSystem
    blockPhaseChange
)
```

### Message Flow (New)

```
gRPC stream goroutine
    ↓ (sends executionEvent to channel)
tea.Cmd listener (polls channel)
    ↓ (returns tea.Msg)
executionTUI.Update(msg)
    ↓ (appends/updates blocks, re-renders viewport content)
executionTUI.View()
    ↓ (renders header + viewport + footer)
Bubbletea runtime
    ↓ (diff-based terminal update)
Terminal
```

### Key Interactions

| Key | Action |
|-----|--------|
| `↑`/`↓` or `j`/`k` | Scroll viewport up/down |
| `Tab` / `Shift+Tab` | Jump focus to next/previous expandable block |
| `Enter` or `Space` | Toggle expand/collapse on focused block |
| `g` | Jump to top |
| `G` | Jump to bottom (re-enables auto-scroll) |
| `q` / `Ctrl+C` | Exit TUI (prints summary to stdout) |
| `?` | Toggle help overlay |

### Auto-Scroll Behavior

1. **Default**: `autoScroll = true` — viewport follows new content
2. **User scrolls up**: `autoScroll = false` — viewport stays put
3. **User presses `G` or scrolls to very bottom**: `autoScroll = true` — resume following
4. **New content arrives + autoScroll**: viewport jumps to bottom after content update

### Approval Integration

When the execution enters `WAITING_APPROVAL` phase:

1. `approvalActive = true`
2. The approval options render inline at the bottom of the viewport (not a separate program)
3. Keyboard input routes to the approval sub-model
4. After the user responds, `approvalActive = false` and streaming resumes
5. The approval interaction is recorded as a `contentBlock` in the history

### Alt-Screen vs Inline Decision [CONFIRMED]

**During execution**: Alt-screen mode (full terminal takeover)
- Clean canvas, no interference with previous terminal output
- Bubbletea handles terminal resize, raw mode, etc.
- Standard for interactive TUI applications

**After exit (q or execution completes)**: Print summary to inline stdout
- The execution summary panel (already exists) prints to normal terminal
- Terminal history shows the summary for later reference
- Matches current behavior for the final output

### Non-TTY Fallback

**Decision**: No fallback. Single code path — always use the Bubbletea TUI. This avoids maintaining two rendering paths and keeps the codebase simpler. A fallback can be added later if a real need arises (e.g., CI/CD, piped output) since it would be an isolated `if` check at the entry point.

## Implementation Phases (Task Breakdown)

### T02: Foundation — Bubbletea Model Shell

Build the basic Bubbletea model that renders the same output as today, but through the Bubbletea rendering pipeline. No interactivity yet.

- Create `executionTUI` struct with `Init()`, `Update()`, `View()`
- Wire gRPC stream messages as `tea.Cmd` / `tea.Msg`
- Render AI messages, tool calls, system messages, phase changes
- Use viewport for scrollable area
- Auto-scroll to bottom on new content
- **Success**: Visually identical to current output, but running inside Bubbletea

### T03: Expand/Collapse for Tool Calls

Add the interactive expand/collapse capability for **all tool types**.

- Extend `contentBlock` with preview/full content and expanded state
- Extend `toolrender` package with `RenderExpanded()` and `formatFileContentFull()`
- All tool types are expandable (read, ls, glob, grep, shell, write, etc.) — even if some don't have a rich preview yet, the expand/collapse abstraction applies universally
- Add `Tab`/`Shift-Tab` focus navigation between expandable blocks
- Add `Enter`/`Space` to toggle expand/collapse
- Visual indicators: `▶` collapsed, `▼` expanded, `▸` focus marker
- Re-render viewport content on toggle
- **Success**: User can Tab to any tool call, press Enter, and see the full result

### T04: Scroll and Navigation Polish

Perfect the scrolling and navigation UX.

- Auto-scroll pause when user scrolls up
- Auto-scroll resume when user reaches bottom or presses `G`
- Jump to top (`g`) / jump to bottom (`G`)
- Scroll-into-view when Tab-focusing a block that's off-screen
- Smooth handling of viewport resize
- **Success**: Scrolling feels natural and predictable

### T05: Approval Prompt Integration

Merge the approval prompt into the TUI model.

- Create `approvalSubModel` that handles approve/skip/reject
- Route keyboard input to approval model when `approvalActive`
- Render approval options inline at the viewport bottom
- Handle rejection reason text input
- Resume streaming after approval response
- Record approval interaction as a `contentBlock`
- **Success**: Approval works without launching a separate Bubbletea program

### T06: Help, Status Bar, and Polish

Final UX polish and edge cases.

- Status bar header (execution ID, phase, duration)
- Footer with key binding hints
- `?` toggles a help overlay
- Terminal resize handling
- Spinner/loading indicator for pending state (Bubbletea spinner component)
- Error state rendering
- Clean exit behavior (summary to stdout)
- **Success**: Production-ready, polished TUI

### T07: Testing and Validation

Comprehensive testing.

- Unit tests for the model (`Update` returns correct state for each message type)
- Unit tests for expand/collapse rendering
- Unit tests for auto-scroll logic
- Integration test: simulate a full execution stream
- Manual testing with real agent executions
- **Success**: High confidence, no regressions

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Approval prompt integration is complex (currently a separate tea.Program) | High — approval is critical path | T02 keeps approval as-is; T05 is dedicated to integration; can ship T02-T04 first |
| Alt-screen loses terminal history | Medium — users may want to copy output | Print summary to inline stdout on exit |
| Performance with many messages | Medium — large executions could lag | Cache rendered block strings; only re-render changed blocks; lazy full-content rendering |
| Streaming text delta rendering in Bubbletea | Medium — current delta approach may not map cleanly | Bubbletea re-renders full View() on each update; streaming text is just a growing string in the model |

## Review Decisions (Resolved 2026-02-14)

1. **Alt-screen vs Inline**: **Confirmed** — Alt-screen during execution, inline summary on exit.

2. **Key bindings**: Keeping proposed Tab/Enter/jk/gG scheme as-is.

3. **Non-TTY fallback**: **Removed** — Single code path (Bubbletea TUI only). No fallback to linear renderer. Can be added later if needed.

4. **Scope boundary**: **All tools expandable** — Every tool type supports expand/collapse, not just reads/ls/glob/grep. The abstraction is universal from the start; expanded rendering for tools without a rich preview yet will be improved incrementally.

## Next Steps

Plan approved. Begin T02 (Foundation — Bubbletea Model Shell).
