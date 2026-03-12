# Show Sub-Agent Status Lines During Tool Output Streaming

**Date**: March 12, 2026

## Summary

Fixed the last remaining gap in the CLI's rendering priority cascade where sub-agent status lines were hidden during tool output streaming. This completes the consistency work started in PR4 — all three coexistence cases (approval, tool streaming, AI streaming) now show sub-agent status lines above their primary content.

## Problem Statement

After PR4 fixed sub-agent visibility during AI streaming, one edge case remained: when tool output is actively streaming (e.g., `read_file` showing file contents) while other sub-agents are running in parallel, the `streamingActive` priority case would hide sub-agent status lines entirely.

### Pain Points

- Users lose visibility of running sub-agents when tool output is streaming
- Inconsistency in the priority cascade — `approvalActive` and `aiStreamActive` show sub-agents alongside, but `streamingActive` does not
- Less common scenario (tool output streaming concurrent with sub-agents) but still a gap in the UX contract

## Solution

Applied the identical `renderSubAgentLine() + "\n\n" + content` pattern established in PR4 to the `streamingActive` case. Both rendering paths (composed `renderTransientContent()` and legacy `View()`) were updated, consistent with the dual-path update pattern documented in PR4.

## Implementation Details

Restructured the `streamingActive` case from two early returns (progressive vs non-progressive) into a single computed `streamView` variable, then applied the sub-agent prepend check at the end. This keeps the sub-agent logic in one place rather than duplicating it across both branches.

Covered both progressive streaming (line-by-line output like `grep`) and non-progressive streaming (header + content like `read_file`).

Added 6 tests following the established PR4 test patterns: non-progressive streaming with active sub-agents, progressive streaming with active sub-agents, streaming with completed sub-agents, `renderTransientContent` for both paths, and a regression guard confirming streaming-only behavior is preserved.

## Benefits

- Fully consistent priority cascade — the rendering contract is now uniform across all cases
- No new abstractions or types — reuses existing `renderSubAgentLine()` and `hasSubAgentActivity()`
- Clean test coverage with both positive assertions and regression guard

## Impact

- CLI users see sub-agent status lines above tool output when both are active simultaneously
- No behavior change when sub-agents are not active (regression-tested)
- Priority cascade table is now complete:
  - `approvalActive`: shows sub-agents (PR4)
  - `streamingActive`: shows sub-agents (D6)
  - `aiStreamActive`: shows sub-agents (PR4)
  - `hasSubAgentActivity()`: standalone display
  - `spinnerActive`: no sub-agents (correct — `hasSubAgentActivity()` takes priority)

## Related Work

- Part of project `20260312.01.agent-execution-consistency-guardrails`
- Deferred follow-up D6 from PR4 (Sub-Agent Completion UX, Session 5)
- Follows the dual-path update pattern documented in PR4 session notes

---

**Status**: Production Ready
