import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallItem } from "./ToolCallItem.js";

/** Props for {@link ToolCallGroup}. */
export interface ToolCallGroupProps {
  /** Tool calls in this group, ordered by invocation time. */
  readonly toolCalls: readonly ToolCall[];
  /** Whether this group is currently focused for keyboard interaction. */
  readonly isFocused?: boolean;
  /** Whether to start in expanded mode (driven by Ctrl+O global toggle). */
  readonly defaultExpanded?: boolean;
}

type AggregateStatus = "running" | "failed" | "completed" | "pending";

function deriveAggregateStatus(toolCalls: readonly ToolCall[]): AggregateStatus {
  let hasRunning = false;
  let hasFailed = false;

  for (const tc of toolCalls) {
    if (tc.status === ToolCallStatus.TOOL_CALL_RUNNING) hasRunning = true;
    if (tc.status === ToolCallStatus.TOOL_CALL_FAILED) hasFailed = true;
  }

  if (hasRunning) return "running";
  if (hasFailed) return "failed";
  const allDone = toolCalls.every(
    (tc) =>
      tc.status === ToolCallStatus.TOOL_CALL_COMPLETED ||
      tc.status === ToolCallStatus.TOOL_CALL_FAILED,
  );
  return allDone ? "completed" : "pending";
}

const STATUS_STYLE: Record<AggregateStatus, { symbol: string; color?: string }> = {
  running: { symbol: "⠋", color: "yellow" },
  completed: { symbol: "✓", color: "green" },
  failed: { symbol: "✗", color: "red" },
  pending: { symbol: "○" },
};

/**
 * Renders a collapsible group of tool calls with an aggregate status.
 *
 * When collapsed, shows a summary line with tool count and status.
 * When expanded, renders each tool call via {@link ToolCallItem}.
 *
 * Press Enter or Space to toggle expansion when `isFocused` is true.
 */
export function ToolCallGroup({
  toolCalls,
  isFocused = false,
  defaultExpanded = false,
}: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const status = deriveAggregateStatus(toolCalls);
  const style = STATUS_STYLE[status];

  useInput(
    (_input, key) => {
      if (key.return || _input === " ") {
        setExpanded((prev) => !prev);
      }
    },
    { isActive: isFocused },
  );

  const summary =
    toolCalls.length === 1
      ? toolCalls[0].name
      : `${toolCalls.length} tool calls`;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box gap={1}>
        <Text color={style.color}>{style.symbol}</Text>
        <Text dimColor>{expanded ? "▼" : "▶"}</Text>
        <Text>{summary}</Text>
      </Box>
      {expanded && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          {toolCalls.map((tc) => (
            <ToolCallItem key={tc.id} toolCall={tc} expanded />
          ))}
        </Box>
      )}
    </Box>
  );
}
