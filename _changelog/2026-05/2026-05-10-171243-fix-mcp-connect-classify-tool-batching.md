# Fix MCP Server Connect: Batch Tool Classification for Large Servers

**Date**: May 10, 2026

## Summary

The MCP server connect workflow failed for servers with large tool counts (e.g., Planton with 232 tools) because the `ClassifyToolApprovals` activity sent all tools to the LLM in a single call, exceeding output token limits and causing a Pydantic validation error. This fix adds batching, dynamic token scaling, and per-batch fallback handling so the connect workflow completes regardless of tool count.

## Problem Statement

When a user added the Planton MCP server (232 tools), the `stigmer/mcp-server/connect` Temporal workflow failed at the `ClassifyToolApprovals` activity with:

```
1 validation error for ClassifyToolApprovalsOutput
approvals
  Field required [type=missing, input_value={}, input_type=dict]
```

### Pain Points

- The LLM structured-output call was capped at `max_tokens=4096`, far too small for 232 tool classifications (~12,000-23,000 tokens needed)
- All tools were sent in a single prompt, making the call unreliable for large servers
- No fallback existed — if the LLM returned invalid output, the entire workflow crashed
- The workflow activity timeout was fixed at 60 seconds, insufficient for batched processing
- Retry policy allowed only 1 attempt with no recovery path

## Solution

Batch the tool classification into groups of 40, scale output tokens per batch, and add per-batch fallback to `requires_approval: true` so the workflow always completes.

## Implementation Details

### `classify_tool_approvals.py`

- **Batching**: `classify_tools()` now splits the tool list into chunks of `BATCH_SIZE=40` and classifies each batch independently via `_classify_batch()`
- **Dynamic `max_tokens`**: Each batch gets `max(4096, len(batch) * 60)` output tokens, scaling with tool count
- **Per-batch fallback**: If any batch fails (LLM error, validation error, timeout), `_fallback_approvals()` marks those tools as `requires_approval: true` — a safe default that lets the connect workflow complete. Users can override individual tools via pinned approvals
- **Structured logging**: Each batch logs its index, tool count, and token budget for observability

### `discover_mcp_server.py`

- **Dynamic activity timeout**: `start_to_close_timeout` scales to `max(120s, (num_tools // 40 + 1) * 60s)` — for 232 tools that's 420 seconds
- **Retry policy**: `maximum_attempts` increased from 1 to 2 to allow one retry at the activity level

## Benefits

- MCP servers with any number of tools can now be connected (tested scenario: 232 tools)
- Individual batch failures don't crash the entire workflow — partial LLM failures degrade gracefully
- Previously connected servers (like Cloudinary with 12 tools) are unaffected — they process in a single batch as before
- The safe-default fallback (`requires_approval: true`) preserves security posture when classification fails

## Impact

- **Users**: Can now add MCP servers with large tool catalogs (Planton, etc.) without hitting connect failures
- **Operators**: Better observability through per-batch logging; failed batches are clearly identified in logs
- **Security**: No regression — fallback is conservative (all tools require approval), matching the principle that `tool_approvals` is the lowest-priority layer overridden by pinned/manual policies

## Related Work

- `2026-05-04-193454-mcp-server-id-classify-workflow-t07.md` — introduced the `ClassifyToolApprovals` activity
- `McpServerConnectHandler.java` (stigmer-cloud) — Java backend that consumes the workflow output

---

**Status**: ✅ Production Ready (requires sandbox image rebuild and deploy)
