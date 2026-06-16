"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { useSessionWriteBacks } from "../useSessionWriteBacks";
import { useSessionFileChanges } from "../useSessionFileChanges";
import { WriteBackCard } from "../../execution/WriteBackCard";
import { FileChangesView } from "../../execution/FileChangesView";

export interface ChangesTabProps {
  readonly executions: readonly AgentExecution[];
}

/**
 * Changes facet for the SessionInspector — mode-aware by workspace type.
 *
 * Git-backed workspaces produce automatic branch/commit/PR write-backs, so
 * those render as `WriteBackCard`s (the PR is the unit of change). Local-folder
 * workspaces have no write-back; their edits render as a consolidated per-file
 * diff via `FileChangesView`. Write-backs only ever populate for git, so their
 * presence cleanly selects the mode; a git run mid-execution may briefly show
 * file diffs before its write-back lands, then upgrade to PR cards.
 */
export function ChangesTab({ executions }: ChangesTabProps) {
  const { writeBacks, hasWriteBacks } = useSessionWriteBacks(executions);
  const { fileChanges, hasFileChanges } = useSessionFileChanges(executions);

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

  if (hasFileChanges) {
    return <FileChangesView changes={fileChanges} />;
  }

  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
      <p className="text-xs text-muted-foreground">
        No changes yet. File edits and pull requests will appear here once the
        agent modifies your workspace.
      </p>
    </div>
  );
}
