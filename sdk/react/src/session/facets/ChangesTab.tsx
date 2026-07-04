"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { useSessionWriteBacks } from "../useSessionWriteBacks.js";
import { WriteBackCard } from "../../execution/WriteBackCard.js";

export interface ChangesTabProps {
  readonly executions: readonly AgentExecution[];
}

/**
 * Changes facet for the session panel — the session's git write-backs
 * (branch/commit/PR), one `WriteBackCard` per entry.
 *
 * Local file changes deliberately do NOT render here: they live in the
 * transcript, where each stamped edit row shows its diff in place and the
 * per-turn decision bar carries the review controls and file list
 * (`FileReviewCard`). Duplicating them in a side panel gave the same change a
 * third rendering with no added authority. The facet therefore only surfaces
 * once a write-back exists (see `useSessionRailViews`).
 */
export function ChangesTab({ executions }: ChangesTabProps) {
  const { writeBacks, hasWriteBacks } = useSessionWriteBacks(executions);

  if (hasWriteBacks) {
    return (
      <div role="list" className="space-y-2">
        {writeBacks.map((entry) => (
          <div key={entry.writeBack.workspaceEntryName} role="listitem">
            <WriteBackCard writeBack={entry.writeBack} />
          </div>
        ))}
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
