"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { useSessionUsage } from "../useSessionUsage.js";
import { UsageWidget } from "../../execution/UsageWidget.js";

export interface UsageTabProps {
  readonly executions: readonly AgentExecution[];
}

/**
 * Usage facet for the session panel (a `useSessionRailViews` rail view).
 *
 * Uses `useSessionUsage` to determine if data exists, then delegates
 * rendering to the existing `UsageWidget`. Shows an empty state when
 * no usage data is available.
 */
export function UsageTab({ executions }: UsageTabProps) {
  const usage = useSessionUsage(executions);

  if (!usage.hasUsage) {
    return (
      <div className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:px-4 stg:py-8 stg:text-center">
        <p className="stg:text-xs stg:text-muted-foreground">
          No usage data yet. Cost and token stats will appear here.
        </p>
      </div>
    );
  }

  return <UsageWidget executions={executions} />;
}
