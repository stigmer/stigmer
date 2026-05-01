# Next Task: 20260430.01.cursor-harness

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260430.01.cursor-harness

**Description**: Integrate the Cursor TypeScript SDK as a premium execution harness alongside Stigmer's native harness within the runner daemon. Introduces the Harness concept to SessionSpec, a new TypeScript Temporal activity worker (ExecuteCursor), embedded Node.js runtime in the CLI, and unified cost/streaming/HITL adapters.
**Goal**: Enable Stigmer sessions to choose between native (standard) and Cursor (premium) execution harnesses. When a session uses the Cursor harness, executions are processed by a TypeScript worker wrapping the Cursor SDK, with full streaming, MCP integration, HITL approval, and unified billing.
**Tech Stack**: TypeScript (Cursor SDK, Temporal SDK), Go (workflow dispatch, CLI daemon), Protocol Buffers (session/execution protos), Node.js/Bun (embedded runtime)
**Components**: protos (session, agentexecution enums), CLI daemon (multi-worker management), Go workflow (dispatch by harness), new TypeScript cursor-runner service, embedded CLI packaging, SDK/React (session harness picker), cost/billing adapter

## Current State

- **Status**: COMPLETE — All tasks done (T01–T09) + gap assessment + automated tests + cloud availability fix + unified model selector + dev-mode startup delay fix
- **Last Session**: May 1, 2026 — Session 15: Fix Dev-Mode Runner Startup Delay
- **Active Task**: None — dev-mode startup delay fixed
- **Branch**: `feat/cursor-harness`

## Session Progress (May 1, 2026 — Session 15)

### Fix Dev-Mode Runner Startup Delay

Fixed a 60-120 second delay when starting runners in dev mode. The root cause was that `setup-sidecar-dev.sh` built the CLI without setting `buildVersion`, so `GetBuildVersion()` returned `"dev"`, which triggered unconditional `refreshDevSource()` in both Python and Node.js runtime managers on every startup — re-extracting source and reinstalling dependencies even when nothing had changed.

**Fix**: Compute a content hash of the embedded source directories and inject it as `buildVersion` via ldflags (e.g., `dev-a4baea168b83`). The existing version-based caching in both runtime managers now works correctly, skipping expensive bootstrap when source is unchanged.

**Changes (1 file, +10 / -2 lines):**

1. **`client-apps/desktop/scripts/setup-sidecar-dev.sh`** — Added content hash computation of `agentrunner/source` and `cursorrunner/source`, injected as `buildVersion` via `-X` ldflags. Dev-mode runner start time reduced from 60-120s to 3-5s.

### Previous Session (April 30, 2026 — Session 14)

Unified Model Selector (Cursor-Style) — merged HarnessSelector and ModelSelector into a single Cursor-style flat model picker. See checkpoint `2026-04-30-session-14.md` for details.

## Next Steps

1. **Fix ApprovalAction enum bug** — correct `APPROVAL_ACTION_APPROVE`/`REJECT`/`ALWAYS_APPROVE` to `APPROVE`/`REJECT`/`ALWAYS_APPROVE` in `approval-state.ts` and `execute-cursor.ts`
2. **End-to-end validation**: Verify unified model selector renders correctly in desktop and web apps
3. Integration testing across the full flow (create session → execution → streaming → billing)
4. PR review and merge of `feat/cursor-harness` branch (stigmer OSS)
5. PR review and merge of CursorProxyController changes (stigmer-cloud)
6. Release

## Context for Resume

- All 228 tests pass: `sdk/react` (228 total across 21 files)
- Verification clean: no linter errors on any modified file
- The unified model selector replaces the two-control pattern (HarnessSelector + ModelSelector) with a single Cursor-style flat picker
- `HarnessSelector` is deprecated but still exported for backward compatibility
- `useNewSessionFlow` continues to work unmodified — it uses `useModelRegistry({ harness })` in single-harness mode
- The `openai` native provider remains in `DISABLED_PROVIDERS` (only Cursor-served OpenAI models are visible)

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-04-30-session-14.md
```

### 2. Plan
```
.cursor/plans/unified_model_selector_72ce7042.plan.md
```

### 3. Previous Checkpoints
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-04-30-session-13.md
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-04-30-session-12.md
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-04-30-session-11.md
```

### 4. Task Plan
```
_projects/2026-04/20260430.01.cursor-harness/tasks/T01_0_plan.md
```

### 5. Design Decisions
```
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-harness-analysis.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/hitl-cursor-hooks-approach.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/execution-interceptors-concept.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-cost-model.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/embedded-packaging-strategy.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-sdk-proxy-support.md
```

---

*This file provides direct paths to all project resources for quick context loading.*
