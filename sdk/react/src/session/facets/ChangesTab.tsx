"use client";

// The session panel's Pull requests view: one card per git write-back, and
// before any push one inline line saying truthfully where a turn's work
// goes. The suite in `__tests__/ChangesTab.test.tsx` pins the words.

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { EmptyState } from "../../empty-state/EmptyState.js";
import { UNSTYLED_LIST } from "../../internal/element-resets.js";
import { useSessionWriteBacks } from "../useSessionWriteBacks.js";
import { WriteBackCard } from "../../run/WriteBackCard.js";

export interface ChangesTabProps {
  readonly runs: readonly Run[];
  /**
   * Whether this session is expected to push its work back to a git
   * remote — a CLOUD session with at least one git workspace entry (local
   * sessions edit the user's own working tree and never write back). Enables
   * the pre-write-back states below, so the facet answers "where does my work
   * go?" before any push exists. Defaults to `false`: a bare `ChangesTab`
   * stays the pure write-back list it always was.
   */
  readonly expectsWriteBack?: boolean;
  /**
   * Whether the session's latest run is settled (terminal). Selects
   * between the pre-write-back states: a live turn says its work is pushed
   * when it ends; a settled session says each turn's work is pushed when the
   * turn ends, and an Undo after it.
   * Only consulted when {@link expectsWriteBack} is set and no write-back
   * exists yet.
   */
  readonly isSettled?: boolean;
}

/**
 * The session panel's Pull requests view (the rail's `changes` view) — the
 * definitive "where did my work go" surface: the session's git write-backs
 * (branch/commit/PR), one `WriteBackCard` per entry, with honest pre-push
 * lines for cloud git sessions whose write-back hasn't happened yet. A turn
 * pushes the tree it left when it ends, and an Undo is pushed after it by
 * the turn that puts the files back; nothing waits for an approval.
 *
 * Local file changes deliberately do NOT render here: they live in the
 * transcript, where each edit row shows its diff in place and each finished
 * turn's Changed group lists its files with Undo. This facet is exclusively
 * the git OUTCOME surface: a turn's work lands here as a branch and pull
 * request.
 */
export function ChangesTab({
  runs: executions,
  expectsWriteBack = false,
  isSettled = false,
}: ChangesTabProps) {
  const { writeBacks, hasWriteBacks } = useSessionWriteBacks(executions);

  if (hasWriteBacks) {
    // One card per repository, 12px apart.
    return (
      <ul role="list" className={`${UNSTYLED_LIST} stg:flex stg:flex-col stg:gap-3`}>
        {writeBacks.map((entry) => (
          <li key={entry.writeBack.workspaceEntryName}>
            <WriteBackCard writeBack={entry.writeBack} />
          </li>
        ))}
      </ul>
    );
  }

  if (expectsWriteBack) {
    return isSettled ? (
      <EmptyState
        variant="first-use"
        size="inline"
        title="Nothing pushed yet"
        description="Each turn's work is pushed to the session's branch when the turn ends, and an Undo is pushed after it."
      />
    ) : (
      <EmptyState
        variant="first-use"
        size="inline"
        title="Nothing pushed yet"
        description="This turn's work is pushed to the session's branch when it ends."
      />
    );
  }

  return (
    <EmptyState
      variant="first-use"
      size="inline"
      title="No pull requests yet"
      description="Pull requests appear here when the agent pushes its work to your repository."
    />
  );
}
