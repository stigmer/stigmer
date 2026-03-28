"use client";

import { useState } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { resolveToolCategory, extractPrimaryArg } from "./tool-categories";
import { FilePathLink } from "./FilePathLink";
import { McpToolDetail } from "./McpToolDetail";

export interface ToolCallDetailProps {
  readonly toolCall: ToolCall;
  readonly className?: string;
}

const TRUNCATION_LINE_LIMIT = 10;

/**
 * Renders the detail panel for a single tool call with
 * category-specific visual treatments.
 *
 * - **Shell tools**: terminal-style code block for command + output
 * - **File tools (read/write/edit)**: file path header + content block
 * - **Search tools (grep/glob)**: pattern header + results list
 * - **Think**: muted italic thought block
 * - **MCP tools**: structured args + parsed result via {@link McpToolDetail}
 * - **Unknown tools**: generic args + result JSON rendering
 *
 * Used inside {@link ToolCallItem} when expanded, but also
 * independently importable by platform builders who compose
 * their own tool call UI.
 *
 * @example
 * ```tsx
 * <ToolCallDetail toolCall={toolCall} />
 * ```
 */
export function ToolCallDetail({ toolCall, className }: ToolCallDetailProps) {
  const category = resolveToolCategory(toolCall.name, toolCall.mcpServerSlug);
  const isFailed = toolCall.status === ToolCallStatus.TOOL_CALL_FAILED;

  return (
    <div className={cn("space-y-2 text-xs", className)}>
      <CategoryRenderer toolCall={toolCall} categoryName={category.category} />

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
// Category-specific renderers
// ---------------------------------------------------------------------------

function CategoryRenderer({
  toolCall,
  categoryName,
}: {
  toolCall: ToolCall;
  categoryName: string;
}) {
  switch (categoryName) {
    case "shell":
      return <ShellToolDetail toolCall={toolCall} />;
    case "read":
      return <FileToolDetail toolCall={toolCall} mode="read" />;
    case "write":
      return <FileToolDetail toolCall={toolCall} mode="write" />;
    case "edit":
      return <FileToolDetail toolCall={toolCall} mode="edit" />;
    case "delete":
      return <FileToolDetail toolCall={toolCall} mode="delete" />;
    case "search":
    case "list":
      return <SearchToolDetail toolCall={toolCall} />;
    case "think":
      return <ThinkToolDetail toolCall={toolCall} />;
    case "mcp":
      return <McpToolDetail toolCall={toolCall} />;
    default:
      return <GenericToolDetail toolCall={toolCall} />;
  }
}

/**
 * Terminal-style rendering for shell/execute tools.
 * Shows the command in a dark terminal block and output below.
 */
function ShellToolDetail({ toolCall }: { toolCall: ToolCall }) {
  const command = extractPrimaryArg(toolCall);
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);

  return (
    <>
      {/* Metadata */}
      <MetadataRow toolCall={toolCall} duration={duration} />

      {/* Command in terminal-style block */}
      {command && (
        <div className="space-y-1">
          <span className="font-medium text-muted-foreground">Command</span>
          <div className="rounded-md border border-border bg-[var(--stgm-terminal-bg,#1a1a2e)] p-2.5">
            <pre className="whitespace-pre-wrap break-words font-mono text-[var(--stgm-terminal-fg,#e0e0e0)]">
              <span className="select-none text-[var(--stgm-terminal-prompt,#6b7280)]">$ </span>
              {command}
            </pre>
          </div>
        </div>
      )}

      {/* Output */}
      {toolCall.result && (
        <div className="space-y-1">
          <span className="font-medium text-muted-foreground">Output</span>
          <div className="rounded-md border border-border bg-[var(--stgm-terminal-bg,#1a1a2e)] p-2.5">
            <CollapsiblePre
              content={toolCall.result}
              className="text-[var(--stgm-terminal-fg,#e0e0e0)]"
            />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * File-oriented rendering for read/write/edit/delete tools.
 *
 * For **read** mode: shows only the metadata row and a clickable
 * path. Content is intentionally omitted — the Read tool's purpose
 * is for the *agent* to consume the file, and the content is either
 * truncated, omitted, or simply noise for the user. The clickable
 * path provides direct access to the source file.
 *
 * For **write/edit/delete** modes: shows the clickable path followed
 * by the content block (what was written/edited) and any result
 * confirmation.
 */
function FileToolDetail({
  toolCall,
  mode,
}: {
  toolCall: ToolCall;
  mode: "read" | "write" | "edit" | "delete";
}) {
  const filePath = extractPrimaryArg(toolCall);
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);

  if (mode === "read") {
    return (
      <>
        <MetadataRow toolCall={toolCall} duration={duration} />
        {filePath && (
          <div className="flex items-center gap-1.5">
            <FilePathIcon />
            <FilePathLink path={filePath} className="text-xs" />
          </div>
        )}
      </>
    );
  }

  const contentFromArgs =
    mode === "write" || mode === "edit"
      ? extractWriteContent(toolCall)
      : null;

  const displayContent = contentFromArgs || toolCall.result;

  return (
    <>
      <MetadataRow toolCall={toolCall} duration={duration} />

      {filePath && (
        <div className="flex items-center gap-1.5">
          <FilePathIcon />
          <FilePathLink path={filePath} className="text-xs" />
        </div>
      )}

      {displayContent && (
        <CollapsibleCode
          label={mode === "delete" ? "Result" : "Content"}
          content={formatResult(displayContent)}
        />
      )}

      {contentFromArgs && toolCall.result && (
        <CollapsibleCode
          label="Result"
          content={formatResult(toolCall.result)}
        />
      )}
    </>
  );
}

/**
 * Search/discovery rendering for grep, glob, list tools.
 * Shows search pattern/path and results.
 */
function SearchToolDetail({ toolCall }: { toolCall: ToolCall }) {
  const pattern = extractPrimaryArg(toolCall);
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);

  return (
    <>
      <MetadataRow toolCall={toolCall} duration={duration} />

      {pattern && (
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-muted-foreground">Pattern:</span>
          <span className="font-mono text-foreground">{pattern}</span>
        </div>
      )}

      {toolCall.result && (
        <CollapsibleCode
          label="Results"
          content={formatResult(toolCall.result)}
        />
      )}
    </>
  );
}

/**
 * Thought rendering. Muted, italic presentation distinct from
 * regular tool output.
 */
function ThinkToolDetail({ toolCall }: { toolCall: ToolCall }) {
  const thought =
    (toolCall.args?.["thought"] as string | undefined) || toolCall.result;

  if (!thought) return null;

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3">
      <CollapsiblePre
        content={thought}
        className="italic text-muted-foreground whitespace-pre-wrap"
      />
    </div>
  );
}

/**
 * Fallback rendering for unknown/MCP tools. Preserves the original
 * generic args + result JSON display.
 */
function GenericToolDetail({ toolCall }: { toolCall: ToolCall }) {
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);

  return (
    <>
      <MetadataRow toolCall={toolCall} duration={duration} />

      {toolCall.args && Object.keys(toolCall.args).length > 0 && (
        <CollapsibleCode
          label="Arguments"
          content={formatJson(toolCall.args)}
        />
      )}

      {toolCall.result && (
        <CollapsibleCode
          label="Result"
          content={formatResult(toolCall.result)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function MetadataRow({
  toolCall,
  duration,
}: {
  toolCall: ToolCall;
  duration: string | null;
}) {
  const hasMetadata = toolCall.mcpServerSlug || duration;
  if (!hasMetadata) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
      {toolCall.mcpServerSlug && (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
          {toolCall.mcpServerSlug}
        </span>
      )}
      {duration && <span>{duration}</span>}
    </div>
  );
}

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
      ? lines.slice(0, TRUNCATION_LINE_LIMIT).join("\n") + "\n\u2026"
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

function CollapsiblePre({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const lines = content.split("\n");
  const needsTruncation = lines.length > TRUNCATION_LINE_LIMIT;
  const [isExpanded, setIsExpanded] = useState(false);

  const displayContent =
    needsTruncation && !isExpanded
      ? lines.slice(0, TRUNCATION_LINE_LIMIT).join("\n") + "\n\u2026"
      : content;

  return (
    <>
      <pre className={cn("whitespace-pre-wrap break-words font-mono", className)}>
        {displayContent}
      </pre>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="mt-1 text-primary hover:text-primary/80 text-xs font-medium transition-colors"
        >
          {isExpanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </>
  );
}

function FilePathIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M7 1H3C2.45 1 2 1.45 2 2V10C2 10.55 2.45 11 3 11H9C9.55 11 10 10.55 10 10V4L7 1Z" />
      <path d="M7 1V4H10" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function extractWriteContent(toolCall: ToolCall): string | null {
  if (!toolCall.args) return null;
  const fields = ["contents", "content", "file_content", "new_text", "new_string", "replacement"];
  for (const field of fields) {
    const val = toolCall.args[field];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

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
