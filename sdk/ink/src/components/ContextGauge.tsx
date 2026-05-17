import React from "react";
import { Box, Text } from "ink";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  useContextWindow,
  type ContextHealth,
  type SummarizationEventView,
} from "@stigmer/react";

/** Props for {@link ContextGauge}. */
export interface ContextGaugeProps {
  /**
   * The execution snapshot from the active stream, or `null`.
   * The gauge extracts `context_info` from the execution status.
   */
  readonly execution: AgentExecution | null;
}

const BAR_WIDTH = 20;

const HEALTH_COLORS: Record<ContextHealth, string> = {
  healthy: "green",
  warning: "yellow",
  critical: "red",
};

const HEALTH_LABELS: Partial<Record<ContextHealth, string>> = {
  warning: "Approaching limit",
  critical: "Near limit",
};

function formatCompactTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Terminal-native context window utilization gauge.
 *
 * Renders an ASCII progress bar with health-based coloring, token counts,
 * and summarization event details. Uses the headless
 * {@link useContextWindow} hook from `@stigmer/react`.
 *
 * Returns `null` when `ContextInfo` is absent (e.g., Cursor harness
 * where context is managed externally).
 *
 * @example
 * ```tsx
 * <ContextGauge execution={activeStreamExecution} />
 * ```
 */
export function ContextGauge({ execution }: ContextGaugeProps) {
  const ctx = useContextWindow(execution);

  if (!ctx.hasContextInfo) return null;

  const filled = Math.round((Math.min(ctx.utilizationPercent, 100) / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  const color = HEALTH_COLORS[ctx.health];
  const healthLabel = HEALTH_LABELS[ctx.health];
  const eventCount = ctx.summarizationEvents.length;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box gap={1}>
        <Text dimColor>Context</Text>
        <Text color={color}>{bar}</Text>
        <Text color={color}>{Math.round(ctx.utilizationPercent)}%</Text>
        <Text dimColor>·</Text>
        <Text dimColor>
          {formatCompactTokens(ctx.currentTokenCount)} /{" "}
          {formatCompactTokens(ctx.contextWindowLimit)} tokens
        </Text>
        {healthLabel && (
          <>
            <Text dimColor>·</Text>
            <Text color={color}>{healthLabel}</Text>
          </>
        )}
        {eventCount > 0 && (
          <>
            <Text dimColor>·</Text>
            <Text dimColor>
              {eventCount} {eventCount === 1 ? "compaction" : "compactions"}
            </Text>
          </>
        )}
      </Box>
      {eventCount > 0 && (
        <LatestEvent event={ctx.summarizationEvents[eventCount - 1]} />
      )}
    </Box>
  );
}

function LatestEvent({ event }: { readonly event: SummarizationEventView }) {
  const reduction = Math.round(event.compressionRatio * 100);

  return (
    <Box paddingLeft={2}>
      <Text dimColor>
        {formatCompactTokens(event.tokensBefore)} →{" "}
        {formatCompactTokens(event.tokensAfter)} tokens ({reduction}% reduction)
        {event.model ? ` · ${event.model}` : ""}
        {event.durationMs > 0 ? ` · ${formatDuration(event.durationMs)}` : ""}
        {event.costUsd > 0
          ? ` · $${event.costUsd < 0.01 ? event.costUsd.toFixed(4) : event.costUsd.toFixed(2)}`
          : ""}
      </Text>
    </Box>
  );
}
