# CLI Inline Tool Deduplication and Approval Border Fix

**Date**: March 4, 2026

## Summary

Fixed four visual issues in the inline streaming renderer: eliminated duplicate tool rendering during streaming (running + completed both visible), added bullet prefix to AI messages matching Claude Code's visual language, removed legacy `renderToolCalls` path that caused tools to appear on the same line as AI text, and restructured approval separator placement to frame the tool between borders with the question in the footer.

## Problem Statement

After the initial inline UX polish session, manual testing of the `stigmer draft mcp-server` flow revealed that the think tool deduplication fix had not been generalized. List, Find, Search, and other tools still showed both a running indicator (`● List() …`) and a completed result (`● List(.)\n    1 entry`) without the running line being erased. Additionally, AI text lacked the bullet prefix used by Claude Code, tools appeared on the same line as preceding AI text due to the legacy `renderToolCalls` path, and the approval separator borders were placed incorrectly.

### Pain Points

- Tool running indicators (e.g., `● List() …`) remained visible when the completed result appeared below, producing duplicate output for every non-read, non-think tool
- AI messages appeared as plain text with no visual marker, making it hard to distinguish agent reasoning from tool output
- Legacy `renderToolCalls` in `AIStreamEndEvent` wrote tool summaries to stderr immediately after AI text on stdout, causing them to appear on the same terminal line
- Approval expanded view placed separators as header/sep/content/sep instead of sep/header+content/sep, misaligning the visual framing

## Solution

Five targeted fixes in the inline streaming renderer:

1. **In-place running-to-completed replacement** — `lastOutputWasRunning` flag tracks whether the most recent stderr write was a running indicator; `renderToolCompleted` erases the running line via `termctl.EraseLines` when the completed event matches the same tool ID with no intervening output
2. **Remove legacy `renderToolCalls`** — deleted the function and its calls from `renderAIStreamEnd` and `renderAIMessage`; tools are now rendered exclusively by their own `ToolRunningEvent`/`ToolCompletedEvent` handlers
3. **AI text bullet prefix** — `agentPrefix` returns `"● "` for main-agent messages; prefix added to both `renderAIStreamStart` (already used it) and `renderAIMessage`
4. **Defensive AI stream closure** — `finishAIStreamIfNeeded` called before the general-case event switch (excluding AI stream events) and at the top of `flushPendingReads`, preventing tool output from sharing a terminal line with unfinished AI text
5. **Approval separator reordering** — `buildExpandedView` and `initPreApprovalStreaming` restructured to place the top separator before the header, framing the tool call between separators with the question in the footer below

## Implementation Details

### In-Place Replacement (`run_stream_inline.go`)

Added `lastOutputWasRunning bool` to `inlineRenderer`. `statusf` and `flushData` clear the flag on every call. `renderToolRunning` sets it to `true` after the `statusf` call. `renderToolCompleted` checks the flag, tool ID match, and `termctl.IsSupported` before erasing. For parallel tools (A running → B running → A completed), the ID mismatch prevents incorrect erasure — a safe cosmetic fallback.

### Legacy Path Removal (`run_stream_inline.go`)

Removed `renderToolCalls` function entirely and its calls from `renderAIStreamEnd` and `renderAIMessage`. This eliminates the triple-rendering issue (legacy `Render()` + compact running + compact completed) and the dual-stream timing bug that caused tools to appear on the same line as AI text.

### AI Bullet Prefix (`run_stream_inline.go`)

`agentPrefix` changed from returning `""` to `"● "` for main-agent messages (empty `subAgentID`). Plain Unicode character with no ANSI styling keeps piped stdout clean. Added the prefix call to `renderAIMessage` alongside the existing usage in `renderAIStreamStart`.

### Stream Closure Safety (`run_stream_inline.go`)

Added a type-switch guard before the general-case `finishAIStreamIfNeeded` call that excludes `AIStreamStartEvent`, `AIStreamDeltaEvent`, and `AIStreamEndEvent` — these events manage stream lifecycle internally. Also added `finishAIStreamIfNeeded` at the top of `flushPendingReads` (only when pending reads exist) to cover pre-switch interception paths.

### Approval Borders (`run_stream_inline_approval.go`, `run_stream_inline_streaming.go`)

`buildExpandedView` reordered: `sep → header → content → sep` (was `header → sep → content → sep`). `initPreApprovalStreaming` reordered: `sep → header` (was `header → sep`). The bottom separator added by `prepareApprovalDisplay` for streamed content remains unchanged.

## Benefits

- Clean tool output: each tool appears exactly once in its final compact form
- AI messages visually distinguishable with `●` bullet prefix matching Claude Code
- No more tools concatenated on the same line as AI text
- Approval expanded view properly frames the tool between separators
- Defensive stream closure prevents edge-case timing bugs

## Impact

- **Inline streaming** — all five fixes improve the primary user-facing output path
- **Piped output** — AI bullet prefix uses plain Unicode (no ANSI), safe for piping
- **Test suite** — 7 new test assertions covering bullet prefix, running flag tracking, legacy path removal, and separator ordering

## Related Work

- Continues from the inline UX polish session (think tool deduplication, emoji removal, session header)
- Generalizes the think tool running-event suppression approach to an in-place replacement pattern for all tools
- Uses `termctl.EraseLines` (Phase 3.0) and `toolrender.RenderCompact` (Phase 2.x) infrastructure

---

**Status**: ✅ Production Ready
**Timeline**: Single session
