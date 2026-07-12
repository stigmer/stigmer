"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { useSessionWriteBacks } from "../useSessionWriteBacks.js";
import { WriteBackCard } from "../../execution/WriteBackCard.js";

export interface ChangesTabProps {
  readonly executions: readonly AgentExecution[];
  /**
   * Whether this session is expected to push its approved changes back to a
   * git remote — a CLOUD session with at least one git workspace entry (local
   * sessions edit the user's own working tree and never write back). Enables
   * the pre-write-back states below, so the facet answers "where does my work
   * go?" before any push exists. Defaults to `false`: a bare `ChangesTab`
   * stays the pure write-back list it always was.
   */
  readonly expectsWriteBack?: boolean;
  /**
   * Whether the session's latest execution is settled (terminal). Selects
   * between the pre-write-back states: a live turn shows the "will be pushed
   * here" promise, a settled one shows the honest "nothing pushed yet".
   * Only consulted when {@link expectsWriteBack} is set and no write-back
   * exists yet.
   */
  readonly isSettled?: boolean;
}

/**
 * Changes facet for the session panel — the definitive "where did my work go"
 * surface: the session's git write-backs (branch/commit/PR), one
 * `WriteBackCard` per entry, with honest pre-push states for cloud git
 * sessions whose write-back hasn't happened yet.
 *
 * Local file changes deliberately do NOT render here: they live in the
 * transcript, where each stamped edit row shows its diff in place and the
 * per-turn decision bar carries the review controls and file list
 * (`FileReviewCard`). This facet is exclusively the git OUTCOME surface —
 * what was reviewed there lands here as a branch and pull request.
 */
export function ChangesTab({
  executions,
  expectsWriteBack = false,
  isSettled = false,
}: ChangesTabProps) {
  const { writeBacks, hasWriteBacks } = useSessionWriteBacks(executions);

  if (hasWriteBacks) {
    // Dense row groups matching the Artifacts facet's list — gap separates
    // entries only in multi-repo sessions (single-entry lists stay seamless).
    return (
      <ul role="list" className="flex flex-col gap-3">
        {writeBacks.map((entry) => (
          <li key={entry.writeBack.workspaceEntryName}>
            <WriteBackCard writeBack={entry.writeBack} />
          </li>
        ))}
      </ul>
    );
  }

  if (expectsWriteBack) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
        <p className="text-xs text-muted-foreground">
          {isSettled
            ? "No changes have been pushed yet. When the agent changes files " +
              "and you approve them, they are pushed to a branch and pull " +
              "request here."
            : "Changes stay in the session workspace while you review them. " +
              "Approved changes are pushed to a branch and pull request here."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
      <p className="text-xs text-muted-foreground">
        No changes yet. Pull requests will appear here once the agent pushes
        its work back to your repository.
      </p>
    </div>
  );
}
