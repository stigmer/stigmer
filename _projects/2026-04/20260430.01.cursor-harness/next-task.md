# Next Task: 20260430.01.cursor-harness

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260430.01.cursor-harness

**Description**: Integrate the Cursor TypeScript SDK as a premium execution harness alongside Stigmer's native harness within the runner daemon. Introduces the Harness concept to SessionSpec, a new TypeScript Temporal activity worker (ExecuteCursor), embedded Node.js runtime in the CLI, and unified cost/streaming/HITL adapters.
**Goal**: Enable Stigmer sessions to choose between native (standard) and Cursor (premium) execution harnesses. When a session uses the Cursor harness, executions are processed by a TypeScript worker wrapping the Cursor SDK, with full streaming, MCP integration, HITL approval, and unified billing.
**Tech Stack**: TypeScript (Cursor SDK, Temporal SDK), Go (workflow dispatch, CLI daemon), Protocol Buffers (session/execution protos), Node.js/Bun (embedded runtime)
**Components**: protos (session, agentexecution enums), CLI daemon (multi-worker management), Go workflow (dispatch by harness), new TypeScript cursor-runner service, embedded CLI packaging, SDK/React (session harness picker), cost/billing adapter

## Current State

- **Status**: COMPLETE -- All tasks done (T01-T09)
- **Last Session**: April 30, 2026 -- T08 SDK/React Session Harness Selector completed
- **Active Task**: None -- all 9 tasks complete
- **Branch**: `feat/cursor-harness`

## Session Progress (April 30, 2026 -- Session 9)

### T08: SDK/React Session Harness Selector
- Created `HarnessOption` type, label map, proto converters in `sdk/react/src/models/harness.ts`
- Created `HarnessSelector` segmented control component with ARIA radiogroup, keyboard navigation, premium indicator
- Added harness-aware model filtering to `useModelRegistry` (cursor harness shows only cursor models)
- Threaded harness through `ModelSelector`, `ComposerToolbar`, `SessionComposer`
- Added harness to `useCreateSession` (converts to proto via `toProtoHarness()`)
- Added harness state with localStorage persistence to `useNewSessionFlow` (per-harness model storage keys)
- Made `usePersistedModel` harness-aware (optional param, harness-qualified storage key)
- Exposed read-only harness from `useSessionPageFlow` (derived from session spec, for badge rendering)
- Updated all barrel exports
- 2 new files, 12 modified files, 231 lines added

## Project Completion Summary

All 9 tasks complete:

| Task | Description | Status |
|------|-------------|--------|
| T01 | Proto Changes (Harness enum, SessionSpec.harness) | Done |
| T02 | HITL Research Spike (Cursor hooks approach) | Done |
| T03 | Cursor Runner TypeScript Service | Done |
| T04 | Workflow Harness Dispatch (Go + Java) | Done |
| T05 | CLI Daemon Multi-Worker + Cursor Proxy | Done |
| T06 | Cost Model and Billing Integration | Done |
| T07 | Session Lifecycle (Cursor Agent Management) | Done |
| T08 | SDK/React Session Harness Selector | Done |
| T09 | Embedded Cursor Runner Packaging | Done |

## Next Steps

Project is feature-complete. Remaining work:
1. Integration testing across the full flow (create session with Cursor harness → execution → streaming → billing)
2. QA on the HarnessSelector UI component
3. PR review and merge of `feat/cursor-harness` branch
4. Release

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-04-30-session-9.md
```

### 2. Task Plan
```
_projects/2026-04/20260430.01.cursor-harness/tasks/T01_0_plan.md
```

### 3. Design Decisions
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
