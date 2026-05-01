# Fix Cursor Runner Silent Error Logging

**Date**: May 1, 2026

## Summary

The Cursor runner's error path was completely silent — when the Cursor SDK agent returned an error, the error message was persisted to MongoDB but never logged to console. This made agent failures invisible in runner logs, requiring MongoDB queries to diagnose issues. Added diagnostic logging at multiple levels to make failures immediately visible.

## Problem Statement

After deploying the MessageAccumulator streaming fix, the Cursor agent started returning `EXECUTION_FAILED` with no visible error in the runner logs. Investigation via MongoDB revealed the error message was `"Cursor run failed"` (a fallback when the SDK provides no detail) and zero stream events were produced — but none of this was discoverable from the logs alone.

### Pain Points

- `ExecuteCursor completed: phase=EXECUTION_FAILED` logged with no error detail
- The Cursor SDK's `run.wait()` result was never logged, making SDK responses opaque
- Stream status events (which may contain error details) were silently dropped
- No way to tell if the stream produced any events at all without querying MongoDB
- Diagnosis required port-forwarding to MongoDB and manual document inspection

## Solution

Added four levels of diagnostic logging to the `execute-cursor.ts` Phase 10–12 pipeline:

1. **Stream status events**: Any `status` event from the Cursor SDK is now logged with full JSON, capturing SDK-level state changes (RUNNING, ERROR, FINISHED)
2. **Stream end summary**: After the stream loop ends, logs the total event count and accumulated message count
3. **Full `run.wait()` result**: The raw SDK response object is logged as JSON before the status mapping switch
4. **Error in completion log**: The completion log line now includes the error message when present

## Benefits

- Agent failures are immediately visible in runner logs without MongoDB access
- The exact Cursor SDK response is captured for every run, successful or failed
- Stream event counts provide at-a-glance confirmation that accumulation is working
- Status events from the SDK are no longer silently dropped

## Impact

- **Cursor runner observability**: All Cursor-powered executions now produce actionable diagnostic logs on failure
- **No behavioral change**: These are logging additions only; no execution flow is modified

## Related Work

- Streaming message fragmentation fix (same session) — the MessageAccumulator change that prompted deployment and exposed the logging gap
- MongoDB investigation confirmed 0 messages / opaque error for the failing execution

---

**Status**: Production Ready
