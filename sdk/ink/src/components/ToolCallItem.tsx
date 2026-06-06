import React from "react";
import { Box, Text } from "ink";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolKind, resolveToolKind, normalizeToolResult } from "@stigmer/sdk";
import type { ToolResultView } from "@stigmer/sdk";

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

// Harness-agnostic labels per kind. Classification is shared with the runner,
// React, and the Go CLI via @stigmer/sdk's resolveToolKind, so Cursor's
// PascalCase tools render with the same labels as native tools here.
const KIND_LABEL: Partial<Record<ToolKind, string>> = {
  [ToolKind.FILE_READ]: "Read",
  [ToolKind.FILE_WRITE]: "Write",
  [ToolKind.FILE_EDIT]: "Edit",
  [ToolKind.FILE_DELETE]: "Delete",
  [ToolKind.SHELL]: "Shell",
  [ToolKind.SEARCH]: "Search",
  [ToolKind.LIST]: "List",
  [ToolKind.FETCH]: "Fetch",
  [ToolKind.WEB_SEARCH]: "Web Search",
  [ToolKind.THINK]: "Thinking",
  [ToolKind.TODO]: "Todos",
  [ToolKind.SUBAGENT]: "Sub-agent",
};

/**
 * Renders a single tool call with a status indicator, label, and an optional
 * expanded result. Labels and results come from the shared `@stigmer/sdk` view
 * model, so a terminal session shows the same semantics (diffs, exit codes,
 * match counts) as the web console.
 */
export function ToolCallItem({ toolCall, expanded = false }: ToolCallItemProps) {
  const indicator = STATUS_INDICATOR[toolCall.status] ?? { symbol: "○" };

  const kind = resolveToolKind(toolCall);
  const label = toolLabel(toolCall, kind);
  const view = normalizeToolResult(toolCall);
  const resultText = expanded ? describeResultView(view) : null;

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={indicator.color}>{indicator.symbol}</Text>
        <Text>{label}</Text>
        {toolCall.status === ToolCallStatus.TOOL_CALL_RUNNING && (
          <Text dimColor>running</Text>
        )}
      </Box>
      {view.type === "error" ? (
        expanded && (
          <Box paddingLeft={3}>
            <Text color="red" wrap="truncate-end">
              {view.message}
            </Text>
          </Box>
        )
      ) : (
        resultText && (
          <Box paddingLeft={3}>
            <Text dimColor wrap="truncate-end">
              {resultText}
            </Text>
          </Box>
        )
      )}
    </Box>
  );
}

function toolLabel(toolCall: ToolCall, kind: ToolKind): string {
  if (toolCall.mcpServerSlug) {
    return `${toolCall.mcpServerSlug}/${toolCall.name}`;
  }
  return KIND_LABEL[kind] ?? toolCall.name;
}

// Renders a concise, terminal-friendly description of a normalized result view.
function describeResultView(view: ToolResultView): string | null {
  switch (view.type) {
    case "diff": {
      const stats =
        view.linesAdded !== undefined || view.linesRemoved !== undefined
          ? ` (+${view.linesAdded ?? 0} -${view.linesRemoved ?? 0})`
          : "";
      return `${view.path}${stats}`;
    }
    case "terminal": {
      const exit =
        view.exitCode !== undefined && view.exitCode !== 0 ? `[exit ${view.exitCode}] ` : "";
      return exit + truncate(view.stdout || view.stderr);
    }
    case "search":
      return `${view.count} ${view.count === 1 ? "match" : "matches"}`;
    case "list":
      return `${view.count} ${view.count === 1 ? "item" : "items"}`;
    case "file":
      return view.path || null;
    case "contentBlocks":
      return truncate(view.blocks.map((b) => b.text ?? `[${b.type}]`).join(" "));
    case "text":
      return truncate(view.text);
    case "json":
      return truncate(JSON.stringify(view.value));
    case "error":
      return view.message;
    case "empty":
      return null;
  }
}

function truncate(s: string, maxLines = 5): string {
  const lines = s.split("\n");
  if (lines.length <= maxLines) return s;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
}
