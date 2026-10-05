/**
 * The words that confirm deleting a workflow. The list's row action and the
 * detail page confirm the same act, so both read this one description.
 *
 * Pinned through both pages by
 * `../__tests__/library-list-pages.orgs.test.tsx` and
 * `../__tests__/WorkflowDetailPage.test.tsx`.
 */
export const WORKFLOW_DELETE_DESCRIPTION =
  "This permanently removes the workflow. " +
  "Past executions are preserved in the execution history. " +
  "This action cannot be undone.";
