import React from "react";
import { Box, Text } from "ink";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { useSessionUsage, formatCost, formatTokenCount } from "@stigmer/react";

/** Props for {@link UsageWidget}. */
export interface UsageWidgetProps {
  /** All executions for the current session (completed + active). */
  readonly executions: readonly AgentExecution[];
}

/**
 * Compact terminal widget showing session-level token usage and cost.
 *
 * Aggregates usage data from `usageSummary` across all executions
 * in the session. Renders nothing when no usage data is available.
 *
 * Uses the headless {@link useSessionUsage} hook from `@stigmer/react`.
 */
export function UsageWidget({ executions }: UsageWidgetProps) {
  const usage = useSessionUsage(executions);

  if (!usage.hasUsage) return null;

  return (
    <Box paddingLeft={1} gap={1}>
      <Text dimColor>
        {formatCost(usage.totalCostUsd)}
        {usage.isEstimated ? " (est.)" : ""} · {formatTokenCount(usage.totalTokens)}{" "}
        tokens · {usage.llmCallCount}{" "}
        {usage.llmCallCount === 1 ? "call" : "calls"}
        {usage.primaryModel ? ` · ${usage.primaryModel}` : ""}
      </Text>
    </Box>
  );
}
