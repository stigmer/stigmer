"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { useSessionWriteBacks } from "../useSessionWriteBacks";
import { WriteBackCard } from "../../execution/WriteBackCard";

export interface ChangesTabProps {
  readonly executions: readonly AgentExecution[];
}

/**
 * Changes facet for the SessionInspector.
 *
 * Wraps the existing `useSessionWriteBacks` hook and renders
 * `WriteBackCard` per write-back entry — the same content as
 * `WriteBacksWidget` but without its section heading (the tab
 * label provides that context).
 */
export function ChangesTab({ executions }: ChangesTabProps) {
  const { writeBacks, hasWriteBacks } = useSessionWriteBacks(executions);

  if (!hasWriteBacks) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
        <p className="text-xs text-muted-foreground">
          No pull requests yet. Changes will appear here when the agent
          writes back to a workspace.
        </p>
      </div>
    );
  }

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
