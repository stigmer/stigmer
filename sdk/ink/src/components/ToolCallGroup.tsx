import React, { useContext, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  FileReviewContext,
  fileReviewRowState,
  extractPrimaryArg,
  type FileReviewRowState,
} from "@stigmer/react";
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
  // Every terminal status counts as done — SKIPPED (user decision) and
  // INTERRUPTED (platform-settled at terminalization, issue #207) included —
  // so a settled group never pins to a live-looking "pending".
  const allDone = toolCalls.every(
    (tc) =>
      tc.status === ToolCallStatus.TOOL_CALL_COMPLETED ||
      tc.status === ToolCallStatus.TOOL_CALL_FAILED ||
      tc.status === ToolCallStatus.TOOL_CALL_SKIPPED ||
      tc.status === ToolCallStatus.TOOL_CALL_INTERRUPTED,
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
 * A compact file-review cue for the collapsed summary line, so a pending edit is
 * visible without expanding the group. Folds the group's stamped edit rows via
 * the same pure {@link fileReviewRowState} the per-row badges use, reading the
 * change sets from {@link FileReviewContext}. Pending takes precedence (it is
 * the actionable state); otherwise a settled group shows its kept/discarded
 * tally. Returns `null` when no row in the group is stamped.
 */
function useReviewCue(
  toolCalls: readonly ToolCall[],
): { readonly label: string; readonly color: string } | null {
  const { changeSetsById } = useContext(FileReviewContext);
  const counts: Record<FileReviewRowState, number> = {
    pending: 0,
    kept: 0,
    discarded: 0,
    failed: 0,
  };
  for (const tc of toolCalls) {
    if (!tc.fileChangeSetId) continue;
    const state = fileReviewRowState(
      changeSetsById.get(tc.fileChangeSetId),
      extractPrimaryArg(tc),
    );
    if (state) counts[state]++;
  }
  if (counts.pending > 0) {
    return { label: `${counts.pending} pending review`, color: "yellow" };
  }
  if (counts.failed > 0) {
    return { label: `${counts.failed} review failed`, color: "red" };
  }
  const settled: string[] = [];
  if (counts.kept > 0) settled.push(`${counts.kept} kept`);
  if (counts.discarded > 0) settled.push(`${counts.discarded} discarded`);
  if (settled.length > 0) return { label: settled.join(" · "), color: "gray" };
  return null;
}

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
  const reviewCue = useReviewCue(toolCalls);

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
        {reviewCue && (
          <Text color={reviewCue.color}>· {reviewCue.label}</Text>
        )}
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
