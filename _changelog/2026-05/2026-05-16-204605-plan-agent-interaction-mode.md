# Plan/Agent Interaction Mode

**Date**: May 16, 2026

## Summary

Added per-execution interaction mode toggle (Plan vs Agent) to the Stigmer platform, enabling users to switch between a read-only planning mode and the default full-access agent mode. Plan mode restricts the agent to analysis-only operations on the native harness (tool-level enforcement) and uses system prompt directives on the Cursor harness (best-effort). The mode picker appears in the session composer toolbar across both web and desktop clients.

## Problem Statement

Stigmer had no way for users to request "think about this, don't change anything." Every execution had full tool access, which meant:

### Pain Points

- Users who wanted to explore approaches before committing to changes had to manually instruct the agent not to write files — unreliable and verbose
- No visual distinction between executions that analyzed vs executions that made changes
- Cursor IDE offers Plan/Ask/Agent mode toggle that Stigmer users expected but couldn't access
- Platform builders embedding Stigmer components had no way to offer a "read-only analysis" mode to their end-users

## Solution

A per-execution `InteractionMode` enum on `ExecutionConfig` (UNSPECIFIED defaults to AGENT, PLAN restricts to read-only). The mode flows from the UI through the proto contract to both runner harnesses, where enforcement happens at the appropriate level for each runtime.

## Implementation Details

**Proto layer**: `InteractionMode` enum in `agentexecution/v1/enum.proto`, `interaction_mode` field (6) on `ExecutionConfig`. Mode lives exclusively on spec (user input) — not duplicated on status.

**Native harness (LangGraph)**: `create_deep_agent()` filters platform tools to the read-only set (`read, ls, glob, grep, search`) when `interaction_mode == PLAN`. Write tools (`write, edit, delete, execute`) are removed from the tool set before graph construction.

**Cursor harness**: System prompt injection via `formatInteractionModePrefix()` — a strongly-worded directive prepended to all prompt variants (enhanced, continuation, HITL). Best-effort enforcement because `@cursor/sdk` has no mode parameter.

**React SDK**: `InteractionModePicker` (segmented control), `InteractionModeBadge`, `SessionComposerSubmitContext.interactionMode`, full data flow through `useCreateAgentExecution` → `useSessionConversation` → `useSessionPageFlow`.

**Client apps**: Identical wiring in web and desktop SessionPage (DD-016 parity).

## Benefits

- Users can safely explore and plan without risk of unintended file changes
- Visual mode badge in execution timeline provides clear feedback
- Per-execution granularity allows mixing Plan and Agent messages in the same session
- SDK-first design: `InteractionModePicker` and `InteractionModeBadge` are embeddable by platform builders
- Clean domain model: mode on spec only, no backend merge handling needed

## Impact

- **Direct users**: Gain Plan mode toggle in session composer (web + desktop)
- **Platform builders**: Can expose mode picker to their end-users via `@stigmer/react`
- **Both harnesses**: Native gets hard enforcement, Cursor gets best-effort
- **54 files modified** across protos, Go/TS/Python/Java/Dart stubs, cursor-runner, agent-runner, React SDK, client apps, and integration tests

## Related Work

- Phase 1-3 (same project): Usage tracking, context window visibility, chat summarization
- Cursor SDK `--mode=plan|ask|agent` CLI flag (inspiration, but not exposed in programmatic SDK)
- `create_filtered_platform_tools()` pattern (pre-existing in subagent_transformer.py, reused here)

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
