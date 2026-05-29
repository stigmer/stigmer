"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionProgress } from "../../execution/ExecutionProgress";

export interface PlanTabProps {
  readonly execution: AgentExecution | null;
}

/**
 * Plan facet for the SessionInspector.
 *
 * Wraps the existing chrome-less {@link ExecutionProgress} component
 * (phase badge + todo list). The `role="region" aria-label="Execution
 * progress"` contract is preserved for E2E and screen readers.
 *
 * Renders nothing when no execution is available (pre-first-run state).
 */
export function PlanTab({ execution }: PlanTabProps) {
  if (!execution) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
        <p className="text-xs text-muted-foreground">
          No execution yet. Send a message to start.
        </p>
      </div>
    );
  }

  return <ExecutionProgress execution={execution} />;
}
