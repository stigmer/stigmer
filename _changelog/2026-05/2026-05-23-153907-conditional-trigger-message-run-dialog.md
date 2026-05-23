# Conditional Trigger Message in Run Workflow Dialog

**Date**: May 23, 2026

## Summary

The "Input Message" field in the Run Workflow dialog is now conditionally shown based on whether the workflow actually references trigger input (`$input`) in its task configurations. Workflows that don't use trigger input (like `daily-notification-plan`) no longer present the confusing, unused field — reducing cognitive load and surfacing only what matters.

## Problem Statement

Every time a user opens the Run Workflow dialog, a large "Input Message" textarea appears at the top, regardless of whether the workflow uses it. For workflows like `daily-notification-plan` that only need environment variables (`POSTGRES_CONNECTION_URL`) and optional date parameters, this field is noise.

### Pain Points

- Users must explain to customers what "Input Message" is and why it's there
- The field occupies prime visual real estate (top of the dialog) despite being irrelevant for most workflows
- Entering a value has no effect if the workflow doesn't reference `$input`
- Required fields (env vars) are pushed below the irrelevant field, violating progressive disclosure

## Solution

A two-part frontend-only fix in `@stigmer/react`:

1. **Detection utility** — `workflowUsesTriggerInput()` recursively scans all task `taskConfig` Struct values for `$input` or `workflow.input.trigger_message` patterns
2. **Conditional rendering with reordering** — Environment variables are shown first (required inputs), followed by the instance selector, then trigger message last (only when relevant). When hidden, a "+ Add trigger input" escape hatch link allows power users to reveal it.

## Implementation Details

### New file: `sdk/react/src/workflow/workflow-uses-trigger-input.ts`

Pure function that accepts a `Workflow` proto and returns `boolean`. Deep-scans the `taskConfig` Struct for each task, checking all string leaves for trigger input patterns.

### Modified: `useRunWorkflowFlow` hook

- Computes `usesTriggerInput` via memoized call to the detection utility
- Exposes `showTriggerMessage` state (defaults to `usesTriggerInput`)
- Provides `setShowTriggerMessage` for the escape-hatch toggle
- Resets visibility state correctly on `reset()`

### Modified: `WorkflowRunForm` component

- Field order changed: env vars → instance selector → trigger message
- Accepts `showTriggerMessage` and `onShowTriggerMessageChange` props
- When hidden: renders a subtle "+ Add trigger input" button
- When shown: renders the textarea with improved label ("Trigger Input") and hint text (`${ $input }`)

### Modified: `WorkflowRunDialog`

- Wires new props from hook to form

### Updated tests

- 11 unit tests for the detection utility (positive, negative, nested, edge cases)
- 5 new tests in `useRunWorkflowFlow.test.tsx` for visibility behavior
- E2E test and helper updated for the new field structure

## Benefits

- **Cleaner UX**: Users only see fields relevant to their workflow
- **Faster workflows**: No time wasted explaining or second-guessing an irrelevant field
- **Progressive disclosure**: Power users retain full access via the toggle
- **No breaking changes**: The API contract is unchanged; trigger message is still sent if provided

## Impact

- **Direct users**: Immediate reduction in confusion when running workflows
- **Platform builders**: SDK consumers get the smart UX automatically via `WorkflowRunDialog`
- **Architecture**: Documents the gap (no `input` declaration in `WorkflowSpec`) and proposes Phase 2 proto enhancement for future work

## Related Work

- Phase 2 (proto enhancement) documented in plan but not implemented — requires proto + codegen + backend migration
- Part of the `20260523.02.workflow-ux-implementation` project

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes implementation
