# Checkpoint: T11 — Run Workflow from UI

**Date**: 2026-05-13
**Task**: T11 — Run Workflow from UI
**Status**: COMPLETE
**Scope**: React SDK (hooks + components) + Web Console integration

## Accomplishments

Built the complete "Run Workflow" experience: behavior hook, form component,
dialog component, and console integration. 3 new SDK files, 4 modified files.
This closes the create-run-observe loop — users can now edit workflows (T10),
run them from the detail page, and watch executions live (T09).

## New Files

### SDK Behavior Hook
- `sdk/react/src/workflow/useRunWorkflowFlow.ts`
  — Orchestrator hook (follows `useNewSessionFlow` pattern). Manages trigger
    message, runtime env overrides, instance selection. Validates required env
    vars, calls `WorkflowExecutionClient.create()`, invokes `onSuccess` with
    execution ID. Framework-agnostic.

### SDK Styled Components
- `sdk/react/src/workflow/WorkflowRunForm.tsx`
  — Presentational form auto-generated from `WorkflowSpec.env` declarations.
    Trigger message textarea, env var inputs with required/secret/description
    support, instance selector (hidden when <=1 instances). All `--stgm-*` tokens.

- `sdk/react/src/workflow/WorkflowRunDialog.tsx`
  — Native `<dialog>` + `showModal()` (same pattern as `ConfirmDialog`).
    Composes `useRunWorkflowFlow` + `WorkflowRunForm`. Header, scrollable body,
    error banner, Cancel/Run Workflow footer with spinner.

## Modified Files

### SDK
- `sdk/react/src/workflow/WorkflowDetailView.tsx`
  — Added `onExecutionClick?: (executionId: string) => void` prop.
    Execution rows in Executions tab now clickable with keyboard a11y
    (`role="link"`, `tabIndex`, Enter/Space handlers).

- `sdk/react/src/workflow/index.ts`
  — Added barrel exports for `useRunWorkflowFlow`, `WorkflowRunForm`,
    `WorkflowRunDialog` and their type exports.

- `sdk/react/src/index.ts`
  — Added top-level exports for the three new artifacts and their types.

### Console
- `client-apps/web/src/domain/workflow/WorkflowDetailPage.tsx`
  — Wired "Run" as `primaryAction`. Added `useWorkflow` + `useWorkflowInstances`
    for dialog data. `WorkflowRunDialog` with `onSuccess` navigation to
    `/workflows/executions/[id]` + toast. Wired `onExecutionClick` for row nav.

## Architecture Notes

- **SDK-first (DD-001)**: All new code lives in `@stigmer/react`. The console
  page is a thin shell that wires callbacks (navigation, toast).
- **Headless-first (DD-003)**: Three layers independently importable:
  `useRunWorkflowFlow` (behavior), `WorkflowRunForm` (styled form),
  `WorkflowRunDialog` (composed dialog).
- **Pattern**: Dialog uses native `<dialog>` element, matching `ConfirmDialog`.
  No new dependencies added.
- **Double-fetch note**: `WorkflowDetailView` fetches instances internally
  (Instances tab), and `WorkflowDetailPage` fetches them separately for the
  dialog. This is intentional (option A from planning) — the fetch is cheap
  and avoids changing the SDK component's internal data flow.

## Verification

- `tsc --noEmit` — clean (sdk/react, sdk/typescript, client-apps/web)
- `eslint` — clean (zero linter errors on all new/modified files)
- All new components use `--stgm-*` tokens, no hardcoded colors
- `useRunWorkflowFlow` has zero Console dependencies

## Open Items

- Trigger message field is a plain textarea; evolve to code editor when
  structured input schemas are added (Phase 2/3)
- Instance selector only shown when >1 instances; default instance auto-resolve
  via `workflow_id` is relied upon for the common single-instance case
