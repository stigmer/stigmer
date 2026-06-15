// Shared, presentation-only formatters for execution output.
//
// These mirror helpers in Go's pkg/display + internal/cli/execution (duration
// math, ellipsis truncation, workflow task-type labels). They live here, away
// from any RPC code, so both `execution trace` and the `run workflow` epilogue
// format durations and task types identically without duplicating the logic.

import { WorkflowTaskType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";

/**
 * Human duration between two ISO 8601 timestamps. Mirrors Go's calculateDuration:
 * "-" when either bound is missing/unparseable, "<n>s" under a minute,
 * "<m>m <s>s" under an hour, "<h>h <m>m" otherwise.
 */
export function calculateDuration(start: string, end: string): string {
  if (start === "" || end === "") return "-";
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "-";

  const totalSeconds = Math.floor((endMs - startMs) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  return `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m`;
}

/** Truncate to `maxLen`, appending "..." when cut. Mirrors Go's display.TruncateWithEllipsis. */
export function truncateWithEllipsis(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  if (maxLen <= 3) return value.slice(0, maxLen);
  return `${value.slice(0, maxLen - 3)}...`;
}

/** Short workflow task-type label. Mirrors Go's formatWorkflowTaskType. */
export function formatWorkflowTaskType(type: WorkflowTaskType): string {
  switch (type) {
    case WorkflowTaskType.WORKFLOW_TASK_AGENT_INVOCATION:
      return "agent";
    case WorkflowTaskType.WORKFLOW_TASK_APPROVAL:
      return "approval";
    case WorkflowTaskType.WORKFLOW_TASK_API_CALL:
      return "api_call";
    case WorkflowTaskType.WORKFLOW_TASK_CONDITIONAL:
      return "condition";
    case WorkflowTaskType.WORKFLOW_TASK_PARALLEL:
      return "parallel";
    case WorkflowTaskType.WORKFLOW_TASK_TRANSFORM:
      return "transform";
    case WorkflowTaskType.WORKFLOW_TASK_CUSTOM:
      return "custom";
    default:
      return "unknown";
  }
}
