# Fix CLI Sub-Agent Streaming and Nesting UX

**Date**: February 25, 2026

## Summary

Fixed a critical bug where sub-agent AI message generation caused the CLI TUI to appear stuck on "Thinking..." indefinitely, with agent responses being silently skipped. Also deduplicated ~90 lines of tool call tracking code and improved the sub-agent nesting UX by suppressing the confusing `↳` indent prefix in single-agent scenarios.

## Problem Statement

When a `stigmer draft skill` or `stigmer run agent` command invoked a sub-agent (via the "task" tool), the TUI would freeze on "Thinking..." for the entire duration of the sub-agent's AI response generation. The AI-generated content would appear to be skipped — the user saw tool calls complete, then nothing until the full response materialized. Additionally, the `↳` sub-agent indent prefix appeared without context, leaking an implementation detail that confused users.

### Pain Points

- **Execution appeared hung**: The "Thinking..." indicator stayed visible for minutes during active AI generation because zero TUI events flowed while the sub-agent was streaming its response.
- **Agent messages silently skipped**: Sub-agent AI responses only appeared after full generation, making the execution feel broken rather than in-progress.
- **Confusing nesting arrow**: The `↳` prefix was shown for sub-agent blocks without any label explaining what it was, creating visual noise for single-agent commands.
- **Duplicated code**: `emitSubAgentToolCallEvents` was a 90-line near-copy of `emitToolCallStateEvents`, creating maintenance burden and parity drift risk.

## Solution

Rewrote the sub-agent message emission to stream AI messages incrementally (matching the top-level pattern), unified the duplicated tool call state tracking into a single parameterized function, and made the `↳` nesting conditional on multi-agent presence.

## Implementation Details

### Fix A: Incremental Sub-Agent AI Streaming

The root cause was in `emitSubAgentMessageEvents` — it returned immediately when encountering a streaming message (`IsStreaming=true`), creating a dead zone where no events reached the TUI. The function was rewritten with a two-phase approach:

- **Phase 1**: If currently streaming, emit `AIStreamDeltaEvent` (content still growing) or `AIStreamEndEvent` (streaming finished)
- **Phase 2**: Process finalized messages and detect new streaming starts via `AIStreamStartEvent`

Added `SubAgentID string` to `AIStreamStartEvent`, `AIStreamDeltaEvent`, and `AIStreamEndEvent` so the TUI can apply correct visual nesting. The shared `streamingState` in the TUI model works because top-level and sub-agent streaming are mutually exclusive — the top-level agent is blocked on the "task" tool while the sub-agent generates.

**Files changed**: `events.go`, `run_stream_subagent.go`, `handle_events.go`, `model.go`

### Fix B: Deduplicate Tool Call State Tracking

`emitToolCallStateEvents` now accepts a `subAgentID string` parameter (empty for top-level). The duplicate `emitSubAgentToolCallEvents` function was removed entirely, with the sub-agent path calling the unified function with the agent's ID. Eliminates ~90 lines of duplicated diffing logic.

**Files changed**: `run_stream_events.go`, `run_stream_subagent.go`

### Fix C: Conditional Sub-Agent Nesting

Added `hasMultipleSubAgents(blocks)` which scans for 2+ distinct `subAgentID` values. The `↳` indent in `renderedBlockText` is now gated on this check. For single-agent commands like `stigmer draft skill`, the sub-agent distinction is an implementation detail — the nesting prefix is suppressed. It activates only when multiple sub-agents are present (multi-agent workflows).

**Files changed**: `render_blocks.go`, `scroll.go`

### Tests

18 new tests covering:
- Full sub-agent streaming lifecycle (start → delta → end)
- Non-AI message skipping behavior
- `SubAgentID` propagation through unified tool call events
- `hasMultipleSubAgents` edge cases (none, single, multiple, empty)
- Nesting suppression in `renderedBlockText`

Existing tests updated for the unified `emitToolCallStateEvents` signature and `blockLineCount` signature.

## Benefits

- **Eliminates the "stuck on Thinking..." hang** — sub-agent AI responses stream incrementally with ~500ms update cadence
- **Agent messages are visible as they generate** — the user sees the response forming in real-time rather than waiting for completion
- **Cleaner UX for single-agent commands** — no unexplained `↳` prefix noise
- **Reduced maintenance burden** — ~90 lines of duplicated tool call tracking code removed; fixes to the tracking logic now automatically apply to both top-level and sub-agent paths
- **Comprehensive test coverage** — 18 new tests for the streaming and nesting behavior

## Impact

- **CLI users** running `stigmer draft`, `stigmer run agent`, or any command that invokes sub-agents will see AI responses streaming in real-time instead of the TUI appearing frozen
- **Multi-agent workflows** retain the `↳` visual nesting when multiple sub-agents are present
- **Snapshot/resume path** is unaffected — stored messages are always finalized, so the streaming bug never manifested there

## Related Work

- [Sub-Agent Visibility in TUI](2026-02-24-175608-sub-agent-visibility-in-tui.md) — introduced the sub-agent event emission and `↳` nesting
- [Streaming AI Messages](2026-02-14-144253-cli-streaming-ai-messages.md) — top-level AIStreamStart/Delta/End pattern that this fix extends to sub-agents
- [Duplicate Agent Messages Fix](2026-02-17-000834-fix-duplicate-agent-messages-streaming-block-index-tracking.md) — block index tracking that enables correct in-place updates during streaming

---

**Status**: ✅ Production Ready
**Timeline**: Single session
