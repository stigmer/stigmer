# Stabilize Cursor Runner Local Agent Store Lookup

**Date**: May 9, 2026

## Summary

Fixed the "Agent not found" error that occurred when the Cursor SDK attempted to resume local agents in Daytona sandboxes. The root cause was the SDK defaulting to `process.cwd()` for its internal state store keying, which differs between the runner's app directory and the user's workspace. The fix passes explicit, session-stable `platform.workspaceRef` and `platform.stateRoot` on every `Agent.create()` and `Agent.resume()` call.

## Problem Statement

Cursor local SDK agents (`agent-` prefix) failed to resume across activity reinvocations within the same session. The `Agent.resume()` call returned "Agent not found" because the SDK's SQLite store was keyed by `process.cwd()`, not the workspace path passed to `local.cwd`.

### Pain Points

- Sessions requiring HITL approval would fail on reinvocation — the agent could not be found after the approval signal
- Sandbox restarts within the same session caused the same failure
- The error was misleading: "agent may have expired" when the data was actually on disk at a different path
- Cursor staff confirmed this as a known SDK bug and recommended explicit platform options as the workaround

## Solution

Pass explicit `platform: { workspaceRef, stateRoot }` derived from the immutable Stigmer `sessionId` on both `Agent.create()` and `Agent.resume()`. This decouples store lookup from `process.cwd()` entirely.

- `workspaceRef`: Synthetic identifier `stigmer-session:{sessionId}` — never a filesystem path, never changes
- `stateRoot`: `~/.stigmer/cursor-sdk-state/{sessionId}` — deterministic, session-isolated, outside user workspace

## Implementation Details

- New `resolvePlatformOptions(sessionId)` helper in `session-lifecycle.ts` — pure derivation + eager `mkdirSync`
- Added `sessionId` as a required field on both `CreateAgentOptions` and `ResumeAgentOptions`
- Platform options wired through `createAgent()`, `resumeAgent()`, and `resolveAgent()`
- Diagnostic logging on every create/resume: `workspaceRef`, `stateRoot`, and `process.cwd()` for production observability
- `execute-cursor.ts` passes `sessionId` (already in scope from `spec.sessionId`) through to `resolveAgent()`
- Integration test updated; new unit test file (18 cases) covering platform propagation

## Benefits

- Agent resume now works reliably within a sandbox lifetime regardless of `process.cwd()`
- HITL approval flows no longer break on reinvocation
- Diagnostic logging makes store-path drift immediately visible in runner logs
- Foundation for Task 3 (graceful resume-or-create with fallback to continuation prompts)

## Impact

- **cursor-runner**: All local agent sessions now use deterministic, session-stable store paths
- **End users**: HITL approval flows and multi-turn sessions become reliable
- **Operators**: Diagnostic logs expose any residual state-root drift

## Related Work

- Part of project `20260509.01.cursor-harness-durability` (Task 1 of 8)
- Enables Task 3 (graceful resume-or-create) which will add fallback to fresh agent + continuation prompt when resume fails even with correct platform options
- Research: `research.cursor-sdk-agent-lifecycle/04.report.gpt.md` confirmed the SDK keying bug and recommended this approach

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~30 min implementation + tests)
