/**
 * The words that confirm deleting an agent. The list's row action and the
 * detail page confirm the same act, so both read this one description.
 *
 * Pinned through both pages by
 * `../__tests__/library-list-pages.orgs.test.tsx` and
 * `../__tests__/AgentDetailPage.test.tsx`.
 */
export const AGENT_DELETE_DESCRIPTION =
  "This permanently removes the agent. " +
  "Past sessions and runs are preserved, but conversations on it cannot continue. " +
  "This action cannot be undone.";
