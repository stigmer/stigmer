// The session usage line in the terminal: tokens, metered calls and the
// primary model, from the session usage report through useSessionUsage.
// Usage is counted in tokens and never priced, so no dollar figure appears;
// the count is compact because it shares one dim line with the model name.

import React from "react";
import { Box, Text } from "ink";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { useSessionUsage } from "@stigmer/react-core";

/** Props for {@link UsageWidget}. */
export interface UsageWidgetProps {
  /** All runs for the current session (completed + active). */
  readonly runs: readonly Run[];
}

/**
 * Compact token count for one terminal line: the integer under a thousand,
 * then one decimal with a "k" or "M" suffix ("18.4k", "1.2M").
 */
function formatCompactTokenCount(count: number): string {
  if (count < 1000) return String(count);
  // 999,950 and up would round to "1000.0k"; it reads as "1.0M" instead.
  if (count < 999_950) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * Compact terminal widget showing the session's token usage: total tokens
 * ("estimated" when any run was counted from its runner's own report rather
 * than the deployment's meter), the metered call count when there is one, and
 * the primary model. Usage is counted in tokens; no price is shown.
 *
 * Renders nothing when the session has no usage yet.
 *
 * Uses the headless {@link useSessionUsage} hook from `@stigmer/react-core`.
 */
export function UsageWidget({ runs }: UsageWidgetProps) {
  const usage = useSessionUsage(runs);

  if (!usage.hasUsage) return null;

  const parts = [`${formatCompactTokenCount(usage.totalTokens)} tokens${usage.isEstimated ? " (estimated)" : ""}`];
  if (usage.llmCallCount > 0) {
    parts.push(`${usage.llmCallCount} ${usage.llmCallCount === 1 ? "call" : "calls"}`);
  }
  if (usage.primaryModel !== "") parts.push(usage.primaryModel);

  return (
    <Box paddingLeft={1} gap={1}>
      <Text dimColor>{parts.join(" · ")}</Text>
    </Box>
  );
}
