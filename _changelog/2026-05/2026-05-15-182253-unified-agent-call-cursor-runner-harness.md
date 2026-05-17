# Unified Agent Call Path + Cursor Runner Integration Test Harness

**Date**: May 15, 2026

## Summary

Unified the workflow `agent_call` execution path to follow a session-first two-step pattern (matching the frontend flow), enabling cursor-runner harness selection. Removed `preferred_runner_id` from `AgentExecutionSpec`, added `harness` to `AgentCallTaskConfig`, and built a complete cursor-runner integration test harness.

## Problem Statement

The workflow `agent_call` path bypassed session creation entirely — creating `AgentExecution` objects directly and leaking session-level concerns (`preferred_runner_id`, harness selection) into the execution spec. This made it impossible to route agent calls to the cursor-runner (TypeScript/Cursor SDK), since the harness field lives on the Session aggregate and the auto-created session always defaulted to NATIVE.

### Pain Points

- No mechanism for workflow authors to specify `harness: cursor` on agent_call tasks
- `preferred_runner_id` on AgentExecutionSpec was a domain model violation (session-level concern on execution spec)
- Agent call flow diverged between frontend (session → execution) and workflow-runner (execution only, Java auto-creates session)
- Cursor-runner had no integration test harness — zero test coverage for the TypeScript Temporal worker

## Solution

Adopted the frontend's two-step pattern for all agent calls: create Session first (carrying harness and runner affinity), then create AgentExecution with the session_id. This places session-level concerns on the Session aggregate and eliminates field duplication on AgentExecutionSpec.

## Implementation Details

### Proto Changes
- Added `harness` field (field 7, type `Harness` enum) to `AgentCallTaskConfig` — workflow authors write `harness: cursor`
- Removed `preferred_runner_id` (field 11) from `AgentExecutionSpec` — no production consumers; runner affinity now exclusively on `Session.spec.runner_id`
- Regenerated all stubs (Go, TypeScript, Java, Python)

### Workflow-Runner (Go)
- Refactored `CallAgentActivity` to two-step: resolve agent → create session → create execution
- `resolveAgent` now returns the full agent object (needed for `default_instance_id`)
- Added `SessionCommandControllerClient` (lazy-initialized gRPC client)
- Added `createSession` method that sets harness, runner_id, and agent_instance_id
- Added harness normalization in `parseConfig`: YAML `"cursor"` → proto `HARNESS_CURSOR`
- Updated YAML-to-proto converter for harness field mapping

### Java Service (stigmer-cloud)
- Removed `preferred_runner_id` dispatch branching in `AgentExecutionCreateHandler.StartWorkflowStep`
- Removed `resolvePreferredRunner` method from `RunnerDispatchService` (no callers)
- Dispatch now always uses `resolveOrProvision` which reads `session.spec.runner_id`

### Cursor-Runner Test Harness
- Built `harness/cursor_runner.go`: manages Node.js cursor-runner as child process
  - Auto-builds `dist/main.js` if stale (mirrors workflow-runner's Go auto-build)
  - Fails fast with clear message if `node_modules` missing
  - Creates isolated workspace directory for file assertions
- Wired into suite with `CURSOR_API_KEY` env var gating
- Two integration tests: `TestWorkflowCursorCall_FileCanary` (workspace file creation) and `TestWorkflowCursorCall_StructuredOutput`
- Rewrote `TestSandboxColocation` to verify `Session.runner_id` instead of removed `preferred_runner_id`
- Extended Makefile to auto-fetch `CURSOR_API_KEY` from Planton

## Benefits

- **Architectural consistency**: workflow agent_call now follows the same session-first pattern as the frontend
- **Domain purity**: session-level concerns (harness, runner affinity) live on the session aggregate, not leaked into execution spec
- **Cursor-runner testable**: full integration test pipeline from workflow YAML through to cursor-runner
- **Zero-friction**: `make test-integration-providers` auto-fetches both Anthropic and Cursor keys

## Impact

- **Workflow authors**: can now specify `harness: cursor` on agent_call tasks
- **Domain model**: `AgentExecutionSpec` is cleaner (no `preferred_runner_id`)
- **Test coverage**: cursor-runner now has integration test harness alongside agent-runner
- **Backward compatible**: `harness` defaults to NATIVE; existing workflows unchanged

## Related Work

- [Workflow Runner Proxy Integration](2026-05-15-111612-workflow-runner-proxy-integration.md) — proxy mode for LLM and agent calls
- Session 12-13: Provider-backed tests (Anthropic agent-runner, LLM calls)
- Session 10: Java signal relay for HITL

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~2 hours)
