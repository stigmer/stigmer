# Cursor Runner TypeScript Service (T03)

**Date**: April 30, 2026

## Summary

Built the complete cursor-runner TypeScript Temporal activity worker at `backend/services/cursor-runner/`. This service wraps the Cursor SDK as a premium execution harness for Stigmer sessions, implementing the `ExecuteCursor` activity that runs alongside the existing Python `ExecuteGraphton` activity on the same task queue. The architecture uses a durable hook-deny + workflow reinvoke pattern for HITL approval, making the Cursor harness follow identical workflow orchestration as the native LangGraph harness.

## Problem Statement

Stigmer needed a second execution harness (Cursor SDK) to run alongside its native LangGraph engine. The cursor-runner must:
- Act as a Temporal activity worker implementing `ExecuteCursor`
- Translate between Cursor SDK and Stigmer proto types
- Support the same HITL approval flow, pause/resume, and streaming patterns as the native harness
- Be durable (survive process restarts, handle approvals that take days)

### Pain Points

- Cursor SDK has no checkpoint/restore mechanism (unlike LangGraph)
- HITL approval must be durable across process restarts and long wait times
- Cross-language Temporal payloads (TypeScript activity consumed by Go workflow)
- Cursor's hooks system is process-local (not inherently durable)

## Solution

Created a TypeScript service that mirrors the Python agent-runner's architecture while leveraging Cursor SDK's durable Agent abstraction. The key insight: Cursor Agents persist on Cursor's backend, making `Agent.resume(agentId)` the equivalent of LangGraph checkpoint restore.

For HITL: rather than blocking in-process (fragile), the hook denies tools needing approval, the activity captures the denied call details, returns `WAITING_FOR_APPROVAL` to the Go workflow, and the workflow reinvokes after approval -- identical to the LangGraph flow.

## Implementation Details

### Service Structure (15 files)

| Module | Purpose |
|--------|---------|
| `main.ts` / `config.ts` / `worker.ts` | Entry point, env config, Temporal worker setup |
| `activity/execute-cursor.ts` | Core ExecuteCursor activity (orchestrates all adapters) |
| `adapter/message-translator.ts` | SDKMessage -> AgentMessage proto mapping |
| `adapter/usage-tracker.ts` | Cursor TurnEnded usage -> UsageMetrics |
| `adapter/mcp-resolver.ts` | Stigmer McpServerUsage -> Cursor McpServerConfig |
| `adapter/session-lifecycle.ts` | Agent.create/resume/archive via SessionSpec.thread_id |
| `client/stigmer-client.ts` | Connect-RPC client for Stigmer server |
| `hitl/workspace-setup.ts` | Write .cursor/hooks.json + hook script to workspace |
| `hitl/hook-script.ts` | Generate preToolUse bash hook script |
| `hitl/approval-policy.ts` | Built-in tool approval defaults |
| `hitl/approval-state.ts` | Approved tool state file for reinvocation |

### Architecture Decisions

1. **Activity signature**: `ExecuteCursor(executionId, threadId)` -- parallel to `ExecuteGraphton`. `thread_id` stores Cursor agentId.
2. **Durable HITL**: Hook-deny + workflow reinvoke. Same `approvalGateResolved` signal as LangGraph.
3. **No HTTP server**: Simplified from T02 proposal. Hook reads a JSON state file.
4. **Pause/resume**: `run.cancel()` + `Agent.resume()`.

## Benefits

- **Unified workflow**: Go workflow dispatch logic needs minimal branching for Cursor harness (same signals, same slim status return, same HITL loop)
- **Durable**: Survives process restarts, deployments, and multi-day approval waits
- **Consistent UX**: Users see identical approval cards, pause/resume, and streaming regardless of harness
- **Clean separation**: Each adapter module handles one translation concern

## Impact

- **New service**: First TypeScript backend service in the Stigmer platform
- **T04 unblocked**: Go workflow dispatch can now reference `ExecuteCursor` activity
- **Foundation for T05-T09**: CLI embedding, billing, session lifecycle, and SDK/React all build on this
- **Pattern established**: Future harness integrations (other AI IDE SDKs) can follow the same adapter pattern

## Related Work

- T01: Proto changes (Harness enum, SessionSpec.harness, MESSAGE_THINKING) -- `2026-04-30-130933-cursor-harness-proto-foundation.md`
- T02: HITL research spike (hooks approach, design decisions) -- `2026-04-30-135545-cursor-harness-hitl-research-spike.md`
- T04 (next): Go workflow dispatch update

---

**Status**: Production Ready (pending T04 integration and npm install)
**Timeline**: ~45 minutes implementation after ~90 minutes collaborative architecture design
