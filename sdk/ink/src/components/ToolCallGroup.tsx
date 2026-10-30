// A turn's consecutive tool uses as one collapsible terminal group: an
// aggregate status, a one-line summary with the group's file-review cue, and,
// expanded, each tool use's row.
import React, { useContext, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ToolUse } from "@stigmer/client";
import {
  FileReviewContext,
  fileReviewRowState,
  type FileReviewRowState,
} from "@stigmer/react-core";
import { editedPath } from "../file-review.js";
import { ToolCallItem } from "./ToolCallItem.js";
import { useRoles, type InkRole } from "../theme.js";

/** Props for {@link ToolCallGroup}. */
export interface ToolCallGroupProps {
  /** Tool uses in this group, in the order the agent made them. */
  readonly toolUses: readonly ToolUse[];
  /** Whether this group is currently focused for keyboard interaction. */
  readonly isFocused?: boolean;
  /** Whether to start in expanded mode (driven by Ctrl+O global toggle). */
  readonly defaultExpanded?: boolean;
}

type AggregateStatus = "running" | "failed" | "denied" | "completed" | "pending";

/**
 * The group's status: running wins, then failed; a group whose every call
 * settled (returned, failed, denied, or stopped when its turn ended — issue
 * #207) is settled, so it never pins to a live-looking "pending". A settled
 * group with a denied call reads as denied, not as a success. A call waiting
 * for a person leaves it pending.
 */
function deriveAggregateStatus(toolUses: readonly ToolUse[]): AggregateStatus {
  if (toolUses.some((tu) => tu.state === "running")) return "running";
  if (toolUses.some((tu) => tu.state === "failed")) return "failed";
  if (toolUses.some((tu) => tu.state === "waiting")) return "pending";
  return toolUses.some((tu) => tu.state === "denied") ? "denied" : "completed";
}

const STATUS_STYLE: Record<AggregateStatus, { symbol: string; role?: InkRole }> = {
  running: { symbol: "⠋", role: "warning" },
  completed: { symbol: "✓", role: "success" },
  failed: { symbol: "✗", role: "danger" },
  denied: { symbol: "⊘", role: "warning" },
  pending: { symbol: "○" },
};

/**
 * A compact file-review cue for the collapsed summary line, so a pending edit is
 * visible without expanding the group. Folds the group's file-edit rows via
 * the same pure {@link fileReviewRowState} the per-row badges use, reading
 * each row's turn's review from {@link FileReviewContext}. Pending takes
 * precedence (it is the actionable state); otherwise a settled group shows its
 * kept/discarded tally. Returns `null` when no row edited a reviewed file.
 */
function useReviewCue(
  toolUses: readonly ToolUse[],
): { readonly label: string; readonly role: InkRole } | null {
  const { fileReviewByRunId } = useContext(FileReviewContext);
  const counts: Record<FileReviewRowState, number> = {
    pending: 0,
    kept: 0,
    discarded: 0,
    failed: 0,
  };
  for (const tu of toolUses) {
    const state = fileReviewRowState(fileReviewByRunId.get(tu.runId) ?? [], editedPath(tu));
    if (state) counts[state]++;
  }
  if (counts.pending > 0) {
    return { label: `${counts.pending} pending review`, role: "warning" };
  }
  if (counts.failed > 0) {
    return { label: `${counts.failed} review failed`, role: "danger" };
  }
  const settled: string[] = [];
  if (counts.kept > 0) settled.push(`${counts.kept} kept`);
  if (counts.discarded > 0) settled.push(`${counts.discarded} discarded`);
  if (settled.length > 0) return { label: settled.join(" · "), role: "muted" };
  return null;
}

/**
 * Renders a collapsible group of tool uses with an aggregate status.
 *
 * When collapsed, shows a summary line with tool count and status.
 * When expanded, renders each tool call via {@link ToolCallItem}.
 *
 * Press Enter or Space to toggle expansion when `isFocused` is true.
 */
export function ToolCallGroup({
  toolUses,
  isFocused = false,
  defaultExpanded = false,
}: ToolCallGroupProps) {
  const role = useRoles();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const status = deriveAggregateStatus(toolUses);
  const style = STATUS_STYLE[status];
  const reviewCue = useReviewCue(toolUses);

  useInput(
    (_input, key) => {
      if (key.return || _input === " ") {
        setExpanded((prev) => !prev);
      }
    },
    { isActive: isFocused },
  );

  const summary =
    toolUses.length === 1
      ? toolUses[0]!.name
      : `${toolUses.length} tool calls`;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box gap={1}>
        <Text {...(style.role ? role[style.role] : {})}>{style.symbol}</Text>
        <Text dimColor>{expanded ? "▼" : "▶"}</Text>
        <Text>{summary}</Text>
        {reviewCue && (
          <Text {...role[reviewCue.role]}>· {reviewCue.label}</Text>
        )}
      </Box>
      {expanded && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          {toolUses.map((tu) => (
            <ToolCallItem key={tu.id} toolUse={tu} expanded />
          ))}
        </Box>
      )}
    </Box>
  );
}
