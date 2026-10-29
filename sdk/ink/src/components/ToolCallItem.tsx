// One tool use as a terminal row: its status glyph, the harness-agnostic
// label (or a shell call's model-authored intent), its live file-review
// badge when it edited a file, a command it started in the background as
// one line beneath it ("Background command `npm test` exited with code 1",
// from the fold's `background`), and, expanded, its result described from
// the shared `@stigmer/client` view model.
import React from "react";
import { Box, Text } from "ink";
import {
  type ToolKind,
  backgroundEndingLine,
  resolveToolKind,
  normalizeToolResult,
  extractShellIntent,
} from "@stigmer/client";
import type { ToolResultView, ToolUse } from "@stigmer/client";
import {
  extractPrimaryArg,
  useFileReviewRowState,
  type FileReviewRowState,
} from "@stigmer/react-sdk/headless";
import { editedPath } from "../file-review.js";

/** Props for {@link ToolCallItem}. */
export interface ToolCallItemProps {
  /** The tool use to render, from the session's fold. */
  readonly toolUse: ToolUse;
  /** Whether to show the full args/result (expanded view). */
  readonly expanded?: boolean;
}

const STATUS_INDICATOR: Record<ToolUse["state"], { symbol: string; color?: string }> = {
  running: { symbol: "⠋", color: "yellow" },
  completed: { symbol: "✓", color: "green" },
  failed: { symbol: "✗", color: "red" },
  // Waiting for a person's answer: the approval prompt carries the action.
  waiting: { symbol: "○" },
  // A person (or a rule) refused it.
  denied: { symbol: "⊘", color: "yellow" },
  // Its turn ended before it returned (issue #207): a neutral "cut short"
  // glyph, distinct from the waiting "○".
  stopped: { symbol: "⊘", color: "gray" },
};

// Harness-agnostic labels per kind. Classification is shared with the runner,
// React, and the CLI's headless renderers via @stigmer/client's resolveToolKind,
// so the Claude harness's PascalCase tools render with the same labels as
// the Stigmer harness's tools here.
const KIND_LABEL: Partial<Record<ToolKind, string>> = {
  file_read: "Read",
  file_write: "Write",
  file_edit: "Edit",
  file_delete: "Delete",
  shell: "Shell",
  search: "Search",
  list: "List",
  fetch: "Fetch",
  web_search: "Web Search",
  think: "Thinking",
  todo: "Todos",
  subagent: "Subagent",
  // The CLI has no consent chip; the labeled row (with the fact as the
  // primary arg) plus the honest "proposed" result text is the whole story —
  // confirm/reject happen in the console's memory surfaces.
  memory: "Remember",
  background_stop: "Stop command",
  skill: "Use skill",
};

// File-review row badges, mirroring the web console's per-row badge labels and
// tones. Keyed by the shared `fileReviewRowState` classification.
const REVIEW_BADGE: Record<FileReviewRowState, { label: string; color: string }> = {
  pending: { label: "Pending review", color: "yellow" },
  kept: { label: "Kept", color: "green" },
  discarded: { label: "Discarded", color: "red" },
  failed: { label: "Review failed", color: "red" },
};

/**
 * Renders a single tool use with a status indicator, label, and an optional
 * expanded result. Labels and results come from the shared `@stigmer/client` view
 * model, so a terminal session shows the same semantics (diffs, exit codes,
 * match counts) as the web console.
 */
export function ToolCallItem({ toolUse, expanded = false }: ToolCallItemProps) {
  const indicator = STATUS_INDICATOR[toolUse.state];

  const kind = resolveToolKind(toolUse);
  const label = toolLabel(toolUse, kind);
  // Model-authored intent titles the row when present (stigmer#276), with
  // the command demoted to dim secondary text — same convention as the web
  // console, extraction shared via @stigmer/client.
  const intent = extractShellIntent(toolUse);
  const title = intent ?? label;
  const commandSubtitle = intent ? extractPrimaryArg(toolUse) : undefined;
  const view = normalizeToolResult(toolUse);
  const resultText = expanded ? describeResultView(view) : null;

  // A file edit badges the live review state of the file it changed, from its
  // turn's file review matched by path (the observational record stays in
  // place; the decision surface is the docked FileReviewPrompt). Null for any
  // other row and for honest-degradation cases (no review yet, a superseded
  // edit).
  const reviewState = useFileReviewRowState(toolUse.runId, editedPath(toolUse));
  const reviewBadge = reviewState ? REVIEW_BADGE[reviewState] : null;
  const backgroundLine = backgroundEndingLine(toolUse);

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={indicator.color}>{indicator.symbol}</Text>
        <Text>{title}</Text>
        {commandSubtitle && (
          <Text dimColor wrap="truncate-end">
            {commandSubtitle}
          </Text>
        )}
        {toolUse.state === "running" && <Text dimColor>running</Text>}
        {reviewBadge && <Text color={reviewBadge.color}>{reviewBadge.label}</Text>}
      </Box>
      {backgroundLine !== undefined && (
        <Box paddingLeft={3}>
          <Text dimColor={toolUse.background?.state !== "running"} color={toolUse.background?.state === "running" ? "yellow" : undefined} wrap="truncate-end">
            {backgroundLine}
          </Text>
        </Box>
      )}
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

function toolLabel(toolUse: ToolUse, kind: ToolKind): string {
  if (toolUse.mcpServerName) {
    return `${toolUse.mcpServerName}/${toolUse.name}`;
  }
  return KIND_LABEL[kind] ?? toolUse.name;
}

// Renders a concise, terminal-friendly description of a normalized result view.
function describeResultView(view: ToolResultView): string | null {
  switch (view.type) {
    case "diff":
      return view.path;
    case "terminal": {
      // Lead with the command prompt line so the CLI reads as one terminal
      // session, matching the web console.
      const prompt = view.command ? `$ ${view.command}\n` : "";
      const exit =
        view.exitCode !== undefined && view.exitCode !== 0 ? `[exit ${view.exitCode}] ` : "";
      return prompt + exit + truncate(view.stdout || view.stderr);
    }
    case "search": {
      const noun =
        view.kind === "files"
          ? view.count === 1 ? "file" : "files"
          : view.count === 1 ? "match" : "matches";
      return `${view.count} ${noun}${view.truncated ? " (truncated)" : ""}`;
    }
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
    case "outputRef": {
      // The full bytes were offloaded to artifact storage. A terminal formatter
      // can't fetch them inline, so we surface the stable storage key (the
      // reference carries no URL).
      const size = view.sizeBytes ? ` (${formatBytes(view.sizeBytes)})` : "";
      if (view.isImage) return `[image output${size}] ${view.storageKey}`;
      const preview = view.preview ? `${truncate(view.preview)}\n` : "";
      return `${preview}[full output offloaded${size}] ${view.storageKey}`;
    }
    case "memoryProposal":
      // The CLI is not a consent surface: state the proposal
      // honestly and point at where the decision happens.
      return `proposed: "${truncate(view.fact)}" — awaiting your decision (confirm or reject in the console's Memory page)`;
    case "error":
      return view.message;
    case "empty":
      return null;
  }
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function truncate(s: string, maxLines = 5): string {
  const lines = s.split("\n");
  if (lines.length <= maxLines) return s;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
}
