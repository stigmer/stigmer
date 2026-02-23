# Fix LLM Stream Token Interleaving

**Date**: February 24, 2026

## Summary

Fixed garbled agent output caused by concurrent LLM streams mixing tokens into the same `AgentMessage` in StatusBuilder. Added `run_id`-based message tracking to isolate each LLM invocation into its own dedicated message, preventing interleaving when sub-agent namespace routing falls back to the main agent.

## Problem Statement

When running `stigmer draft skill` with multiple `--attach` directories, the agent creates parallel sub-agents (via `task` tool calls) to read files from each directory. The output showed garbled, mixed text:

> "I'll read Let me start by reading all them all at once.7 files."

Two separate LLM responses were being interleaved token-by-token into the same `AgentMessage`.

### Pain Points

- Agent output was unreadable when sub-agents ran concurrently
- The garbled text made it impossible to understand what the agent was doing
- Root cause was silent — no warnings or errors indicated misrouted events

## Solution

Applied the same `run_id`-based tracking pattern already used for tool calls to LLM chat model streaming. Each LLM invocation now writes exclusively to its own `AgentMessage`, regardless of namespace routing.

## Implementation Details

All changes are in `status_builder.py` with corresponding tests:

- **New `_llm_run_id_to_message` dict**: Maps each LLM invocation's `run_id` to its owning `AgentMessage`. No two LLM invocations can share a message.
- **Rewrote `_handle_chat_model_stream_event`**: Three-path resolution:
  - `run_id` present and mapped → fast-path append to tracked message
  - `run_id` absent → legacy backwards-scan fallback (backward compatible)
  - `run_id` present, first token → create new message, register in map
- **Updated `_handle_chat_model_end_event`**: Resolves and finalizes the correct message by `run_id` (with backwards-scan fallback), then cleans up the map entry.
- **Added WARNING log in `_get_execution_context`**: Emits a warning when a non-empty namespace fails to match any registered sub-agent, making the fallback-to-main-agent path visible.
- **7 new tests** in `TestLLMStreamIsolation`: Covers concurrent stream isolation, same-`run_id` accumulation, selective finalization, map cleanup, legacy fallback, multi-turn isolation, and a three-stream stress test.

## Benefits

- Agent output is now correct when sub-agents run concurrently
- Namespace routing failures are now logged as warnings for diagnostics
- Backward compatible — events without `run_id` use the previous behaviour
- Low risk — adds a lookup without changing event processing order

## Impact

- **Agent Runner**: All agent executions that involve sub-agents (parallel `task` tool calls) benefit from correct message isolation
- **CLI**: No changes needed — the CLI correctly renders whatever the backend provides
- **Diagnostics**: New warning log surfaces namespace routing mismatches that were previously silent

## Related Work

- Previous fix for duplicate agent messages (2026-02-17-000834)
- Think tool streaming UX (2026-02-24-012820)
- Extended thinking integration (2026-02-24-005527)

---

**Status**: Production Ready
**Timeline**: Single session
