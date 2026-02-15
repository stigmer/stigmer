# CLI Interactive Execution Viewer: Bubbletea TUI Foundation (T02)

**Date**: February 14, 2026

## Summary

Implemented the foundation of an interactive Terminal User Interface (TUI) for the Stigmer CLI's agent execution viewer. Built using Bubbletea/Bubbles, the new TUI replaces the linear stdout renderer with a full alt-screen interface featuring scrollable content, streaming AI messages, structured tool call display, and inline approval handling. This foundational work establishes the architecture for future interactive features like expand/collapse tool results, scroll navigation, and rich approval prompts.

## Problem Statement

The existing CLI agent execution viewer used a linear stdout renderer that wrote output incrementally as events arrived. While functional, this approach had significant limitations:

### Pain Points

- **No scrollback within execution**: Once content scrolled past the terminal buffer, it was lost. Users couldn't review earlier messages or tool calls without external terminal scrollback (which was unreliable in tmux/screen).
- **No interactive features**: Tool results were printed in full. No way to expand/collapse large outputs, no focus navigation, no rich interactions.
- **Approval UX limitations**: The existing approval prompt was a separate Bubbletea program that ran inline, which worked but couldn't integrate with the execution display for richer context.
- **Terminal history pollution**: Long executions with many tool calls filled the terminal history, making it hard to find the final summary or previous commands.
- **No visual hierarchy**: All content flowed linearly with minimal structure. Hard to scan or understand execution flow at a glance.

The core architectural issue: the renderer was tightly coupled to stdout writes, making it impossible to add interactive features without a fundamental rewrite.

## Solution

Built a new Bubbletea-based TUI architecture that runs in alt-screen mode during execution, providing a clean interactive canvas while preserving terminal history through a post-exit summary print.

**Key architectural decisions**:

1. **Alt-screen mode**: Full-screen TUI during execution (like vim/htop), returning to inline mode when done. This enables interactive features while keeping terminal history clean.

2. **Event-driven architecture**: gRPC stream runs in a goroutine, converting proto updates to domain-agnostic TUI events sent over a buffered channel. The Bubbletea model receives events and updates the viewport asynchronously.

3. **Domain separation**: New `pkg/executiontui/` package accepts primitive types (strings, enums, `toolrender.ToolCallInfo`) with zero proto imports. Callers in `cmd/` handle proto-to-TUI conversion, following the same pattern as the existing `toolrender` package.

4. **Minimal inline approval**: Instead of nested Bubbletea programs, approval is handled as a TUI state where key presses (a/s/r) flow back to the gRPC goroutine via a channel. Simple, non-blocking, and ready for T05's richer approval UI.

5. **Auto-scroll viewport**: Uses `charmbracelet/bubbles/viewport` with auto-follow for new content. Lays groundwork for T04's scroll-pause-resume behavior.

## Implementation Details

### New Package: `pkg/executiontui/` (11 files, 1319 lines)

**Core Model** (`model.go`, `update.go`, `view.go`):
- `Model` struct manages viewport, content blocks, state (streaming, approval, phase)
- `Update()` dispatches events, key presses, window resizes
- `View()` renders header (execution ID + phase icon), viewport, context-aware footer

**Event System** (`events.go`, `messages.go`):
- 12 event types: AI messages (streaming start/delta/end), human messages, tool results, system messages, phase changes, approval, done, errors
- `listenForEvents()` tea.Cmd bridges channel to Update loop (standard Bubbletea pattern)

**Content Blocks** (`blocks.go`, `render_blocks.go`):
- `contentBlock` abstraction with `blockType` enum (AI, human, tool, system, phase, approval)
- Block rendering delegates to `toolrender.Render()` for tool calls, maintains visual parity with existing renderer
- Streaming AI messages render with animated cursor (`▍`) until finalized

**Approval Handling** (`approval.go`):
- `approvalState` tracks pending approval (tool name, args, message)
- Key handler captures a/s/r, sends `ApprovalResponse` to goroutine asynchronously
- Approval block renders in viewport with bold key hints

**Tests** (`update_test.go`, `render_blocks_test.go`):
- 28 unit tests covering all event types, streaming lifecycle, window resize, approval flow, quit behavior
- All tests pass; no regressions in existing stream renderer tests

### Modified Files: `cmd/stigmer/root/`

**`run_stream.go`** (206 lines, -108 net):
- `streamAgentExecution()` completely rewired: removed spinner + `messageStreamRenderer`, replaced with TUI setup
- Creates event/approval channels, launches `streamToEvents()` goroutine, runs `tea.NewProgram()` in alt-screen
- After TUI exits, calls `fetchFinalExecution()` to get final state, prints `displayAgentExecutionComplete()` to inline stdout
- Net -108 lines (simplification from complex multi-track approval handling to clean TUI orchestration)

**`run_stream_events.go`** (244 lines, new):
- `streamToEvents()`: gRPC stream loop in goroutine, owned the events channel lifecycle (close on exit)
- Delta-tracking for AI streaming (same logic as `messageStreamRenderer`, but emits events instead of stdout writes)
- Dual-track approval detection (tool-call-level + phase-level) reused from existing code
- Approval blocking: sends `ApprovalNeededEvent`, waits for response on channel, calls `submitAgentApproval()`

**`run_stream_convert.go`** (75 lines, new):
- Proto-to-TUI type converters: `mapPhaseToString()`, `convertToolCalls()`, `mapApprovalResponseToDecision()`, `findToolCallByID()`
- Extracted from `run_stream_events.go` to keep files under 250-line guideline

### Unchanged Files (explicitly preserved)

- `run_display_stream.go`: Kept for reference and workflow path (workflow execution still uses linear renderer)
- `run_display_tools.go`: `convertToolCall()` reused directly by new code
- `run_stream_approval.go`: Approval detection functions (`findUnpromptedApproval`, `needsAgentApprovalPrompt`) reused
- `pkg/toolrender/`, `pkg/approval/`, `pkg/spinner/`: All unchanged (spinner still used by workflow path)

### Quality Verification

- **Build**: `go build ./...` passes
- **Vet**: `go vet` clean on all packages
- **Tests**: 28 new tests (all passing), 7 existing stream tests (no regressions)
- **File sizes**: Every source file under 250 lines (most 65-150, ideal range per coding guidelines)
- **No proto imports in pkg/**: Domain separation maintained
- **Single Responsibility**: Each file has exactly one reason to change

## Benefits

### Immediate (T02)

1. **Scrollable execution history**: Users can scroll up/down during execution to review earlier messages, tool calls, phase changes. No more lost context when output exceeds terminal buffer.

2. **Clean terminal history**: Alt-screen mode isolates the TUI. After execution completes, only the summary appears in terminal history—no 500-line tool call dumps polluting scrollback.

3. **Structured display**: Header bar shows execution ID + phase icon. Content blocks are visually separated. Footer shows context-aware key hints.

4. **Streaming AI text**: AI responses flow incrementally with animated cursor, maintaining the responsive feel of the old renderer while enabling viewport interactions.

5. **Inline approval**: Approval requests appear as content blocks in the viewport with clear key hints. Feels integrated rather than external.

6. **Foundation for T03-T07**: The architecture supports expand/collapse, focus navigation, scroll-pause, rich approval UX—all planned features that were impossible with the linear renderer.

### Developer Experience

- **Cleaner codebase**: `-108 lines` in `run_stream.go` from eliminating spinner coordination, multi-track approval sync, and renderer state management
- **Testable**: TUI model is fully unit-testable (28 tests) vs. stdout renderer which required output parsing
- **Maintainable**: Domain separation (pkg/executiontui/ has zero proto imports), single-responsibility files (all under 250 lines)
- **Extensible**: Event-driven architecture makes adding new event types trivial (just add to events.go, handle in update.go)

## Impact

### Users

- **Better UX for long executions**: Executions with 10+ tool calls or multi-page AI responses are now navigable. Users can review what happened instead of blindly trusting the final summary.
- **Cleaner terminal**: No more accidentally scrolling through 1000 lines of tool outputs when reviewing command history.
- **Progressive disclosure**: Lays groundwork for expand/collapse (T03), where users can hide tool result details until needed.

### Platform

- **Parity with modern tools**: The TUI brings Stigmer CLI in line with tools like Claude Code, GitHub Copilot CLI, and Warp that provide rich, interactive output.
- **Differentiation**: The planned interactive features (expand/collapse, focus navigation) will set Stigmer apart from purely linear CLI agents.

### Development

- **Workflow path unaffected**: Workflow execution (`streamWorkflowExecution`) still uses the linear renderer. T02 changes are isolated to agent execution path.
- **No breaking changes**: The TUI is an internal implementation swap. Agent execution API, approval flow, and final summary display are unchanged from user's perspective.

## Related Work

### T01: Planning & Architecture

- [T01_0_plan.md](/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260214.02.cli-interactive-execution-viewer/tasks/T01_0_plan.md) defined the 7-phase roadmap and architectural blueprint
- Research into Claude Code, Aider, and Warp's terminal rendering approaches informed the alt-screen decision

### Next Phases (T03-T07)

- **T03**: Expand/collapse for tool call results
- **T04**: Scroll navigation (scroll-pause on user scroll, resume on 'G')
- **T05**: Rich approval UX (arrow key selection, rejection reason text input)
- **T06**: Polish (help overlay, status bar, spinner component for in-progress states)
- **T07**: Testing & stability (comprehensive test suite, edge case handling)

### Foundational Packages Reused

- `pkg/toolrender/`: Tool call structured display (unchanged, reused by TUI)
- `pkg/approval/`: Approval types and submission API (unchanged, reused by TUI goroutine)
- `charmbracelet/bubbletea`, `charmbracelet/bubbles`: TUI framework dependencies

---

**Status**: ✅ Production Ready (T02 scope complete)  
**Timeline**: Single session (February 14, 2026)  
**LOC Added**: +1319 lines (pkg/executiontui/), +319 lines (cmd/), -108 lines (simplified run_stream.go)  
**Tests**: 28 new unit tests, 0 regressions
