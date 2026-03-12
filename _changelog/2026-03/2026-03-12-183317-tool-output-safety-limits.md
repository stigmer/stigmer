# Tool Output Safety Limits

**Date**: March 12, 2026

## Summary

Added universal tool output truncation to prevent LLM context overflow and gRPC transport failures. A single `truncate_tool_output()` function enforces a 120K-character ceiling on every tool result returned to the model, using head+tail windowing so the agent retains both the beginning (setup/headers) and end (errors/summary) of large outputs. A separate display-level cap protects gRPC payloads, and the default message size limit was raised from 4 MiB to 16 MiB as a transport backstop.

## Problem Statement

A sub-agent running `find` across the Planton monorepo produced ~719K tokens of tool output, instantly exceeding the 200K-token context window (`AnthropicContextOverflowError`). The same oversized result also blew past the default 4 MiB gRPC message limit, causing cascading `RESOURCE_EXHAUSTED` errors on Temporal status updates.

### Pain Points

- Any tool returning unbounded output (shell commands, file reads, glob matches, grep results, MCP tool responses) could single-handedly overflow the context window
- The summarization middleware runs *before* model calls, not *after* tool results are appended — so a single massive tool result causes immediate overflow with no chance for compaction
- gRPC status updates accumulated full tool results with no size cap, hitting the default 4 MiB transport limit
- No observability into when or how often truncation would have helped

## Solution

Two-layer truncation modeled after Claude Code's approach (hard ceiling at the tool output boundary) rather than Cursor's file-offload pattern (which would pollute server-side workspaces and require agent learning):

1. **LLM context protection**: `truncate_tool_output()` in `tool_wrappers.py` — head+tail truncation with an actionable notice telling the model how to narrow its query
2. **gRPC transport protection**: `_MAX_STATUS_RESULT_CHARS` in `status_builder.py` — separate, independent cap on the display payload streamed to the CLI
3. **Transport backstop**: gRPC max message size raised to 16 MiB in `channel.py`

## Implementation Details

### `truncate_tool_output()` — the core mechanism

- **Threshold**: 120,000 characters (~30K tokens, ~15% of a 200K-token window)
- **Window**: First 500 lines + last 100 lines, with a structured notice in between
- **Fast path**: Output under the threshold passes through with zero allocation
- **Observability**: WARNING-level log emitted on every truncation with tool name, original size, and truncated size

### Coverage — every tool path that can produce unbounded output

| Tool | Protection |
|------|-----------|
| `execute` | `_format_shell_success()` and `_format_shell_failure()` pass through `truncate_tool_output()` |
| `read` | Applied after `_apply_line_range()` |
| `glob` | Applied to the joined match list |
| `grep` | Applied to summary + results |
| MCP tools (no-approval) | `create_tool_wrapper()` coerces result to string, then truncates |
| MCP tools (approval) | `create_approval_aware_tool_wrapper()` same treatment |
| `write`, `edit` | Safe by design — one-line confirmation messages |
| `search` | Safe by design — capped at 20 results with short signatures |
| `ls` | Safe by design — single directory, not recursive |

### StatusBuilder display cap

- `_MAX_STATUS_RESULT_CHARS = 50,000` — independent from the LLM cap
- Applied to both streaming accumulation (`_handle_tool_progress_event`) and final assignment (`_handle_tool_end_event`)
- Appends `[output truncated for display]` when capped

### gRPC message size

- `_MAX_MESSAGE_BYTES = 16 MiB` added to `KEEPALIVE_CHANNEL_OPTIONS`
- Covers both send and receive directions

## Benefits

- **Eliminates context overflow from tool output**: No single tool call can consume more than ~15% of the context window
- **Eliminates gRPC transport failures**: Display cap + raised message limit prevents `RESOURCE_EXHAUSTED`
- **Universal coverage**: Every tool path — platform tools and arbitrary MCP tools — is protected
- **Zero cost for normal output**: Fast-path check means well-behaved tool calls have no overhead
- **Actionable feedback**: Truncation notice tells the model exactly how to narrow its query
- **Observable**: Every truncation event is logged with full size details for monitoring

## Impact

- **Agent reliability**: Sub-agents exploring large monorepos can no longer crash from unbounded tool output
- **Agent-runner service**: gRPC status streaming is resilient to large payloads
- **CLI users**: Tool output display is bounded, preventing massive payloads from overwhelming the terminal
- **All MCP integrations**: External tool responses are now safely bounded regardless of what the MCP server returns

## Related Work

- Builds on existing truncation patterns: `_MAX_LISTING_ENTRIES` in `filesystem.py`, `max_results=1000` in grep, `max_results=20` in search
- Complements the summarization middleware (`summarization_middleware.py`) which handles cumulative context growth across turns
- Design informed by analysis of Claude Code (hard truncation + microcompaction) and Cursor (file-based context offload) approaches

---

**Status**: Production Ready
**Files Changed**: 3 (tool_wrappers.py, status_builder.py, channel.py)
**Lines Changed**: +136 / -10
