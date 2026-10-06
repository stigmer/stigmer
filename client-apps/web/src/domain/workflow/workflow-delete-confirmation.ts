/**
 * The words that confirm deleting a workflow. The list's row action and the
 * detail page confirm the same act, so both read this one description.
 *
 * Pinned through both pages by `__tests__/WorkflowOrgScope.test.tsx`.
 */
export const WORKFLOW_DELETE_DESCRIPTION =
  "This permanently removes the workflow. " +
  "Past runs are preserved in the run history. " +
  "This action cannot be undone.";
