# Sub-Agent Execution Sequence Ordering

**Date**: March 14, 2026

## Summary

Added an explicit `sequence` field to `SubAgentExecution` to make invocation ordering a first-class domain property. This eliminates CLI/UI flicker caused by array-position instability across status updates, serialization round-trips, or concurrent writes.

## Problem Statement

When an `AgentExecution` delegates work to multiple sub-agents, the `sub_agent_executions` repeated field carried no explicit ordering information. The CLI relied on array position to determine display order, but that position could shift between status updates.

### Pain Points

- CLI flicker when sub-agent list order changed between consecutive status updates
- Ordering was an implicit artifact of list position rather than an enforced domain invariant
- No resilience against concurrent status updates or serialization round-trips reordering the array
- On resume-after-approval paths, dict-based lookup structures could produce iteration orders diverging from the original append order

## Solution

Made ordering an explicit, immutable property of each `SubAgentExecution` by adding a monotonically increasing `sequence` field assigned at creation time. Clients sort by `sequence` for stable display regardless of wire order.

## Implementation Details

### Proto Change (`subagent.proto`)

Added `uint32 sequence = 15` to `SubAgentExecution`. Zero-based, assigned at creation, immutable after set. The proto comment documents that clients MUST sort by this field for stable display.

### Python StatusBuilder

- Added `_next_sub_agent_sequence` counter initialized to `max(existing sequences) + 1` — handles both fresh starts (defaults to 0) and resume-after-approval paths
- Each new `SubAgentExecution` receives the next sequence value before the counter increments

### Go Server

No changes required. The existing full-replacement merge strategy (`status.SubAgentExecutions = statusUpdates.SubAgentExecutions`) preserves the field transparently.

## Benefits

- Ordering survives every serialization boundary: proto wire format, Go server, store (SQLite/MongoDB), broadcast, CLI
- Race-proof: concurrent updates containing the same sub-agents with embedded sequence values produce identical display order
- Resume-safe: counter initializes from persisted max, so new sub-agents after approval resume get correct sequence values
- CLI can sort by `sequence` in a single line, eliminating flicker

## Impact

- **Proto**: Additive, non-breaking field addition — old clients ignore `sequence`, new clients use it
- **Agent Runner**: ~10 lines changed in `status_builder.py`
- **CLI**: Requires a one-line sort before rendering (downstream task)

## Related Work

- [Sub-Agent Display Flickering Fix](2026-03-11-062209-fix-sub-agent-display-flickering.md) — earlier attempt addressing symptoms at the CLI layer
- [Sub-Agent Flicker Double-Buffer Atomic Complete](2026-03-11-082256-fix-sub-agent-flicker-double-buffer-atomic-complete.md) — rendering-side mitigation

---

**Status**: ✅ Production Ready
