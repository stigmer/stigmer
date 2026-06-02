"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { useSessionUsage } from "../useSessionUsage";
import { UsageWidget } from "../../execution/UsageWidget";

export interface UsageTabProps {
  readonly executions: readonly AgentExecution[];
}

/**
 * Usage facet for the SessionInspector.
 *
 * Uses `useSessionUsage` to determine if data exists, then delegates
 * rendering to the existing `UsageWidget`. Shows an empty state when
 * no usage data is available.
 */
export function UsageTab({ executions }: UsageTabProps) {
  const usage = useSessionUsage(executions);

  if (!usage.hasUsage) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
        <p className="text-xs text-muted-foreground">
          No usage data yet. Cost and token stats will appear here.
        </p>
      </div>
    );
  }

  return <UsageWidget executions={executions} />;
}
