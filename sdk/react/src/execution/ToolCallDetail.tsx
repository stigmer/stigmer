"use client";

import { useState } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";

export interface ToolCallDetailProps {
  readonly toolCall: ToolCall;
  readonly className?: string;
}

const TRUNCATION_LINE_LIMIT = 10;

/**
 * Renders the detail panel for a single tool call: arguments,
 * result, error, MCP server, and timing.
 *
 * Used inside {@link ToolCallItem} when expanded, but also
 * independently importable by platform builders who compose
 * their own tool call UI.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <ToolCallDetail toolCall={toolCall} />
 * ```
 */
export function ToolCallDetail({ toolCall, className }: ToolCallDetailProps) {
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const isFailed = toolCall.status === ToolCallStatus.TOOL_CALL_FAILED;

  return (
    <div className={cn("space-y-2 text-xs", className)}>
      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        {toolCall.mcpServerSlug && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
            {toolCall.mcpServerSlug}
          </span>
        )}
        <StatusLabel status={toolCall.status} />
        {duration && <span>{duration}</span>}
      </div>

      {/* Arguments */}
      {toolCall.args && Object.keys(toolCall.args).length > 0 && (
        <CollapsibleCode
          label="Arguments"
          content={formatJson(toolCall.args)}
        />
      )}

      {/* Result */}
      {toolCall.result && (
        <CollapsibleCode
          label="Result"
          content={formatResult(toolCall.result)}
        />
      )}

      {/* Error */}
      {isFailed && toolCall.error && (
        <div className="space-y-1">
          <span className="font-medium text-destructive">Error</span>
          <pre className="whitespace-pre-wrap break-words rounded-md border border-destructive/20 bg-destructive/5 p-2 font-mono text-destructive">
            {toolCall.error}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function StatusLabel({ status }: { status: ToolCallStatus }) {
  const { label, colorClass } = STATUS_LABEL_MAP[status] ?? {
    label: "Unknown",
    colorClass: "text-muted-foreground",
  };
  return <span className={colorClass}>{label}</span>;
}

const STATUS_LABEL_MAP: Record<
  ToolCallStatus,
  { label: string; colorClass: string }
> = {
  [ToolCallStatus.TOOL_CALL_STATUS_UNSPECIFIED]: {
    label: "Unknown",
    colorClass: "text-muted-foreground",
  },
  [ToolCallStatus.TOOL_CALL_PENDING]: {
    label: "Pending",
    colorClass: "text-muted-foreground",
  },
  [ToolCallStatus.TOOL_CALL_RUNNING]: {
    label: "Running",
    colorClass: "text-foreground",
  },
  [ToolCallStatus.TOOL_CALL_COMPLETED]: {
    label: "Completed",
    colorClass: "text-success",
  },
  [ToolCallStatus.TOOL_CALL_FAILED]: {
    label: "Failed",
    colorClass: "text-destructive",
  },
  [ToolCallStatus.TOOL_CALL_WAITING_APPROVAL]: {
    label: "Waiting for approval",
    colorClass: "text-warning",
  },
  [ToolCallStatus.TOOL_CALL_SKIPPED]: {
    label: "Skipped",
    colorClass: "text-muted-foreground",
  },
};

/**
 * A code block that collapses when content exceeds
 * {@link TRUNCATION_LINE_LIMIT} lines. Shows a toggle to reveal
 * the full content.
 */
function CollapsibleCode({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  const lines = content.split("\n");
  const needsTruncation = lines.length > TRUNCATION_LINE_LIMIT;
  const [isExpanded, setIsExpanded] = useState(false);

  const displayContent =
    needsTruncation && !isExpanded
      ? lines.slice(0, TRUNCATION_LINE_LIMIT).join("\n") + "\n…"
      : content;

  return (
    <div className="space-y-1">
      <span className="font-medium text-muted-foreground">{label}</span>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-mono text-foreground">
        {displayContent}
      </pre>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="text-primary hover:text-primary/80 text-xs font-medium transition-colors"
        >
          {isExpanded
            ? "Show less"
            : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatJson(obj: object): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function formatResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return result;
  }
}

/**
 * Returns a human-readable duration string from two ISO 8601
 * timestamps. Returns `null` when either timestamp is empty or
 * invalid.
 */
export function formatDuration(
  startedAt: string,
  completedAt: string,
): string | null {
  if (!startedAt || !completedAt) return null;

  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();

  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  const ms = end - start;
  if (ms < 0) return null;

  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
