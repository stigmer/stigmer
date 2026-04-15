import React from "react";
import { Box, Text } from "ink";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/** Props for {@link ToolCallItem}. */
export interface ToolCallItemProps {
  /** The tool call to render. */
  readonly toolCall: ToolCall;
  /** Whether to show the full args/result (expanded view). */
  readonly expanded?: boolean;
}

const STATUS_INDICATOR: Record<number, { symbol: string; color?: string }> = {
  [ToolCallStatus.TOOL_CALL_RUNNING]: { symbol: "⠋", color: "yellow" },
  [ToolCallStatus.TOOL_CALL_COMPLETED]: { symbol: "✓", color: "green" },
  [ToolCallStatus.TOOL_CALL_FAILED]: { symbol: "✗", color: "red" },
};

/**
 * Renders a single tool call with a status indicator, name, and
 * optional expanded args/result preview.
 */
export function ToolCallItem({ toolCall, expanded = false }: ToolCallItemProps) {
  const indicator = STATUS_INDICATOR[toolCall.status] ?? {
    symbol: "○",
  };

  const serverSlug = toolCall.mcpServerSlug;
  const label = serverSlug
    ? `${serverSlug}/${toolCall.name}`
    : toolCall.name;

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={indicator.color}>{indicator.symbol}</Text>
        <Text>{label}</Text>
        {toolCall.status === ToolCallStatus.TOOL_CALL_RUNNING && (
          <Text dimColor>running</Text>
        )}
      </Box>
      {expanded && toolCall.argsPreview && (
        <Box paddingLeft={3}>
          <Text dimColor wrap="truncate-end">
            {toolCall.argsPreview}
          </Text>
        </Box>
      )}
      {expanded &&
        toolCall.status === ToolCallStatus.TOOL_CALL_COMPLETED &&
        toolCall.result && (
          <Box paddingLeft={3}>
            <Text dimColor wrap="truncate-end">
              {truncateResult(toolCall.result)}
            </Text>
          </Box>
        )}
      {expanded &&
        toolCall.status === ToolCallStatus.TOOL_CALL_FAILED &&
        toolCall.error && (
          <Box paddingLeft={3}>
            <Text color="red">{toolCall.error}</Text>
          </Box>
        )}
    </Box>
  );
}

function truncateResult(result: string, maxLines = 5): string {
  const lines = result.split("\n");
  if (lines.length <= maxLines) return result;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
}
