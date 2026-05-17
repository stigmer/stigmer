# Run Workflow from UI (T11)

**Date**: May 13, 2026

## Summary

Added the ability to run workflow executions directly from the Workflow Detail Page in the web console. Users click "Run," fill in a trigger message and any required environment variables, and the workflow starts executing with navigation to the Execution Viewer. This closes the create-run-observe loop that began with the YAML Editor (T10) and Execution Viewer (T09).

## Problem Statement

Workflows could be viewed, edited, and their executions monitored — but there was no way to actually *start* an execution from the UI. Users had to use the API or CLI to trigger runs, then navigate to the execution viewer separately.

### Pain Points

- No "Run" button on the workflow detail page
- No form to specify trigger message or runtime environment variables
- No connection between the workflow detail page and execution viewer
- Execution rows in the detail page's Executions tab were not clickable

## Solution

Built a three-layer SDK-first implementation (behavior hook, form component, dialog component) following the established `useNewSessionFlow` pattern from the agent domain. The console page wires the dialog to a "Run" primary action button and navigates to the execution viewer on success.

## Implementation Details

**New SDK files (3):**
- `useRunWorkflowFlow` — behavior hook managing form state, validation, and `WorkflowExecutionClient.create()` submission
- `WorkflowRunForm` — auto-generated form from `WorkflowSpec.env` declarations with trigger message textarea, env var inputs, and instance selector
- `WorkflowRunDialog` — native `<dialog>` wrapper composing the hook and form with cancel/run buttons and loading/error states

**Modified files (4):**
- `WorkflowDetailView` — added `onExecutionClick` callback prop with keyboard-accessible execution rows
- `WorkflowDetailPage` — wired "Run" as primary action, dialog lifecycle, navigation to execution viewer
- `sdk/react/src/workflow/index.ts` and `sdk/react/src/index.ts` — barrel exports

## Benefits

- Users can trigger workflow executions without leaving the browser
- Form auto-generates required fields from workflow's env var declarations
- Seamless navigation from run to execution viewer
- Execution rows in the detail page are now clickable (closing the observe loop)
- Platform builders can use `useRunWorkflowFlow` hook directly for custom "run" UIs

## Impact

- **End users**: Can now run workflows directly from the console
- **Platform builders**: New `useRunWorkflowFlow`, `WorkflowRunForm`, and `WorkflowRunDialog` available as SDK exports
- **Phase 1 progress**: T08-T11 + T13/T13b complete; remaining: T12 (CLI), T14 (Dashboard)

## Related Work

- T09: Execution Viewer (the destination after running)
- T10: YAML Editor (editing before running)
- T13/T13b: Backend task type implementation (what actually executes)

---

**Status**: ✅ Production Ready
