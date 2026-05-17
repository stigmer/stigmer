# Session Notes: 2026-05-15 — T16 Batch 2: Generation Dialog (SDK + Console Integration)

## Accomplishments

- Created `useGenerateWorkflowFlow` behavior hook following `useRunWorkflowFlow` pattern
- Created `WorkflowGenerateDialog` two-phase dialog component following `WorkflowRunDialog` pattern
- Integrated "Generate" button + dialog into both web and desktop `WorkflowListPage` (DD-016 parity)
- Updated barrel exports in `sdk/react/src/workflow/index.ts` and `sdk/react/src/index.ts`
- Updated empty state description to mention the Generate button

## Decisions Made

- **AD-T16-B2-001: Two-Phase Dialog** — single `<dialog>` with Phase 1 (input: prompt + advanced options) and Phase 2 (result: explanation + YAML preview + warnings). Rationale: generation takes 10-30s and produces a result the user must review before committing (Nielsen's heuristic #3: user control and freedom).
- **AD-T16-B2-002: WorkflowListPage Entry Point Only** — "Generate" button on list page only (both web and desktop). Editor toolbar integration deferred to Batch 3.
- **AD-T16-B2-003: Create via `workflow.apply()` After Generation** — dialog calls `parseWorkflowYaml()` then `workflow.apply()` to create the workflow, then navigates to detail page.
- **AD-T16-B2-004: No `WorkflowGenerateInline` in Batch 2** — deferred to Batch 3 where it pairs with the refinement panel.
- **AD-T16-B2-005: Task Kind Hints as Progressive Disclosure** — hidden behind collapsible "Advanced options" (Hick's Law).

## Key Code Changes

### New Files (2)
- `sdk/react/src/workflow/useGenerateWorkflowFlow.ts` — Behavior hook managing two-phase lifecycle: generation (calls `WorkflowClient.generateFromPrompt()`) and creation (calls `parseWorkflowYaml()` + `WorkflowClient.apply()`). `useRef`-stabilized callbacks, `getUserMessage()` for error extraction, min 10 char prompt validation.
- `sdk/react/src/workflow/WorkflowGenerateDialog.tsx` — Two-phase styled dialog. Phase 1: prompt textarea, collapsible advanced options (model, task kind hints), spinner during generation. Phase 2: explanation, `<pre>` YAML preview, warnings banner, Create Workflow / Try Again / Close buttons. Native `<dialog>` + `showModal()`, `max-w-2xl`, all `--stgm-*` tokens.

### Modified Files (4)
- `sdk/react/src/workflow/index.ts` — Added barrel exports for T16 hook, types, dialog, and props
- `sdk/react/src/index.ts` — Added top-level re-exports for all T16 Batch 2 symbols
- `client-apps/web/src/domain/workflow/WorkflowListPage.tsx` — Added Sparkles icon "Generate" button in page header, `WorkflowGenerateDialog` with `navigateToDetail` on success
- `client-apps/desktop/src/pages/workflow/WorkflowListPage.tsx` — DD-016 parity: identical button + dialog wiring with `navigate()` instead of `navigateToDetail()`

## Learnings

- The plan specified wrapping the return value in `useMemo` (DD-010), but the `useRunWorkflowFlow` pattern it references does NOT actually use `useMemo` — it returns a plain object. Followed the actual existing pattern for consistency rather than introducing a new convention.
- The existing `useRunWorkflowFlow` does not use `toError()` — it uses `getUserMessage()` directly from `@stigmer/sdk`. Followed the same approach.
- Both web and desktop `WorkflowListPage` already had `useStigmer` imported, so the `stigmer` client was available but unused by the generate dialog (the dialog composes `useGenerateWorkflowFlow` internally which calls `useStigmer()` itself).

## Open Questions

- Refine (Batch 3) will need conversation state for iterative prompt refinement — should this be client-managed or server-managed?
- Should generated workflows be flagged as "generated" in metadata for analytics?

## Next Session Plan

1. T16 Batch 3: Refine Workflow — `refineWorkflowFromFeedback` RPC + chat-style iteration UI
2. T16 Batch 4: Diagnose Workflow — `diagnoseWorkflow` RPC + error analysis + repair suggestions
