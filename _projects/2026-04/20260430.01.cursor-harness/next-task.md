# Next Task: 20260430.01.cursor-harness

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260430.01.cursor-harness

**Description**: Integrate the Cursor TypeScript SDK as a premium execution harness alongside Stigmer's native harness within the runner daemon. Introduces the Harness concept to SessionSpec, a new TypeScript Temporal activity worker (ExecuteCursor), embedded Node.js runtime in the CLI, and unified cost/streaming/HITL adapters.
**Goal**: Enable Stigmer sessions to choose between native (standard) and Cursor (premium) execution harnesses. When a session uses the Cursor harness, executions are processed by a TypeScript worker wrapping the Cursor SDK, with full streaming, MCP integration, HITL approval, and unified billing.
**Tech Stack**: TypeScript (Cursor SDK, Temporal SDK), Go (workflow dispatch, CLI daemon), Protocol Buffers (session/execution protos), Node.js/Bun (embedded runtime)
**Components**: protos (session, agentexecution enums), CLI daemon (multi-worker management), Go workflow (dispatch by harness), new TypeScript cursor-runner service, embedded CLI packaging, SDK/React (session harness picker), cost/billing adapter

## Current State

- **Status**: COMPLETE — All tasks done (T01–T09) + gap assessment + automated tests + cloud availability fix + unified model selector
- **Last Session**: April 30, 2026 — Session 14: Unified Model Selector (Cursor-Style)
- **Active Task**: None — unified model selector fully implemented and tested
- **Branch**: `feat/cursor-harness`

## Session Progress (April 30, 2026 — Session 14)

### Unified Model Selector (Cursor-Style)

Merged the separate HarnessSelector and ModelSelector into a single Cursor-style flat model picker with search, expanding the Cursor model catalog from 3 to 16 models.

**Changes (9 files, +542 / -192 lines):**

1. **`sdk/react/src/models/registry.ts`** — Extended `ModelInfo` with `harness` and `featured` fields. Expanded `Provider` type to include `"google"` and `"xai"`. Removed `"cursor"` from `DISABLED_PROVIDERS`. Added 16 Cursor-harness models (IDs verified against `model-pricing.ts`). Added `modelKey()` and `parseModelKey()` utility functions.

2. **`sdk/react/src/models/useModelRegistry.ts`** — Added unified mode (no `harness` arg) returning models from both engines. Added `featured` (curated subset) and `getByKey` (compound key lookup) to return value. Backward-compatible single-harness modes preserved.

3. **`sdk/react/src/models/ModelSelector.tsx`** — Rewrote from `@base-ui/react` Select to Popover-based Cursor-style flat picker. Search input, curated default list (~10 featured models), "Show All Models" expansion, engine tags ("Stigmer"/"Cursor"), cost tier indicators, checkmark on selected, keyboard navigation, proper ARIA roles.

4. **`sdk/react/src/composer/ComposerToolbar.tsx`** — When `showModelSelector` is true, `HarnessSelector` is now suppressed. Unified `ModelSelector` receives `onHarnessResolved` wired to toolbar's `onHarnessChange`.

5. **`sdk/react/src/composer/SessionComposer.tsx`** — Removed harness-switch model reset effect (now internal to ModelSelector). Added compound key resolution in `handleSubmit` so raw `modelId` is passed to consumer.

6. **`sdk/react/src/models/HarnessSelector.tsx`** — Marked as `@deprecated` with guidance to use `ModelSelector` in unified mode. Export preserved for backward compatibility.

7. **`sdk/react/src/models/index.ts`** / **`sdk/react/src/index.ts`** — Added `modelKey` and `parseModelKey` to public API.

8. **`sdk/react/src/models/__tests__/useModelRegistry.test.tsx`** — Rewritten for unified/native/cursor semantics. 24 tests covering featured models, compound key lookup, provider filtering, and backward compat.

**Test results**: All 228 tests pass across 21 test files.

### Key Design Decisions
- **Flat list over hierarchy**: Copied Cursor's model picker pattern — no tabs, no grouping
- **Compound keys**: `"${harness}/${modelId}"` used internally since the same model can appear under both engines
- **Curated defaults**: 10 featured models (2 Stigmer + 8 Cursor) shown by default; "Show All" expands to ~30
- **Implicit harness resolution**: Selecting a model from a different engine automatically updates the session harness via `onHarnessResolved`

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
