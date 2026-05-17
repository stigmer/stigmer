# CLI `--mode=plan` Flag

**Date**: May 17, 2026

## Summary

Added a `--mode` flag to the Stigmer CLI that sets `interaction_mode` on `ExecutionConfig`, completing the Plan mode story across all client surfaces. The flag propagates through to the Ink terminal UI for follow-up executions and shows a visible mode badge in the session header. CLI users can now run `stigmer run agent foo --mode plan` for read-only analysis sessions.

## Problem Statement

Plan mode was implemented in Session 6 (proto contract, runner enforcement, React SDK, web/desktop client apps) but CLI users had no way to access it. The `--model` flag was the only `ExecutionConfig` field exposed, leaving a gap in the CLI-to-web feature parity story.

### Pain Points

- CLI users could not create plan-mode executions
- The Ink terminal UI had no mode awareness for follow-up executions
- No visual indication of mode in the CLI session header

## Solution

Two-layer implementation that mirrors the existing `--model` flag pattern:

1. **Go CLI layer**: `--mode` flag registered on `agentExecFlags` (shared by `run`, `draft`, and all picker paths), validated early in `prepareAgentExec`, mapped to `InteractionMode_INTERACTION_MODE_PLAN` on `ExecutionConfig` via a testable `buildExecutionConfig` helper.

2. **Ink terminal UI layer**: Mode passed as `--mode` CLI arg to the `stigmer-ink` subprocess, threaded through `SessionApp` → `SessionView`, wired to `sendFollowUp(..., { interactionMode })` so all follow-ups inherit the mode. Dimmed "Plan mode" indicator shown above the input.

## Implementation Details

**Go CLI (7 files modified):**
- `agentExecFlags.Mode` + `registerAgentExecFlags` flag registration
- `validateMode()` — rejects invalid values with a clear error message
- `buildExecutionConfig(model, mode)` — extracted pure function handling `--model` + `--mode` co-existence
- `sessionHeaderInfo.Mode` → `Mode: Plan (read-only)` in header panel
- `inkConfig.Mode` → `--mode` arg appended to Ink subprocess invocation
- Mode threaded at all 6 `resolvedAgentExecInput` construction sites

**Ink SDK (3 files modified):**
- `stigmer-ink.tsx`: `--mode` / `-M` arg parsing with validation
- `SessionApp.tsx`: `mode` prop forwarded to `SessionView`
- `SessionView.tsx`: `sendFollowUp` wired with `interactionMode`, plan mode indicator

**Tests (3 new files, 14 test cases):**
- `validateMode` — 6 table-driven tests (valid/invalid values)
- `buildExecutionConfig` — 5 table-driven tests (nil/model/plan/agent/combined)
- `formatMetadataSection` mode row — 3 tests (empty/agent/plan)

## Benefits

- CLI users can create plan-mode executions: `stigmer run agent foo --mode plan`
- `stigmer draft` gets `--mode` for free via shared flag registration
- Follow-up executions in the Ink TUI inherit the mode automatically
- Session header clearly indicates when plan mode is active
- Existing integration test (`TestAgentExecution_PlanMode`) validates end-to-end enforcement

## Impact

- **CLI users**: Can now use plan mode from the terminal
- **`stigmer run`**: New `--mode` flag (backward compatible — empty default)
- **`stigmer draft`**: Inherits `--mode` via shared `registerAgentExecFlags`
- **`@stigmer/ink`**: `SessionView` and `SessionApp` accept optional `mode` prop
- **No breaking changes**: All new fields are optional with backward-compatible defaults

## Related Work

- [Plan/Agent Interaction Mode](_changelog/2026-05/2026-05-16-204605-plan-agent-interaction-mode.md) — Proto contract, runner enforcement, React SDK (Session 6)
- [Build from Plan UX Flow](_changelog/2026-05/2026-05-17-104303-build-from-plan-ux-flow.md) — PlanCompletionCard, SessionComposerHandle (Session 7)

---

**Status**: Production Ready
**Timeline**: Session 8 of the cursor-experience-parity project
