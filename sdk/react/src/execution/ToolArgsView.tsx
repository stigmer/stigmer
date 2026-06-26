"use client";

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import {
  resolveToolCategory,
  extractWriteContentFromPreview,
} from "./tool-categories";
import type { ToolCategory, ToolCategoryInfo } from "./tool-categories";
import { FilePathLink } from "./FilePathLink";
import { McpArgsView, McpMetadataRow } from "./McpToolDetail";
import { useSandboxNormalize } from "./SandboxContext";
import {
  CollapsibleCode,
  FilePathIcon,
  formatJson,
} from "./tool-rendering-primitives";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link ToolArgsView}. */
export interface ToolArgsViewProps {
  /**
   * Raw tool name as it appears on the ToolCall or PendingApproval.
   * Used for category resolution and MCP metadata display.
   */
  readonly toolName: string;
  /**
   * Parsed tool arguments — either from `ToolCall.args` or
   * `JSON.parse(PendingApproval.argsPreview)`.
   */
  readonly args: Record<string, unknown> | null;
  /** MCP server slug for MCP tool classification and metadata. */
  readonly mcpServerSlug?: string;
  /**
   * Whether the file-tool view renders the path row. Defaults to `true`. Set to
   * `false` where an ancestor already names the file (the approval gate header),
   * so the write/edit content shows without restating the path.
   */
  readonly showFileName?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Unified tool-arguments renderer used by both {@link ApprovalCard}
 * (pre-execution) and {@link ToolCallDetail} (post-execution).
 *
 * Resolves the tool category from `toolName` + `mcpServerSlug`,
 * extracts the relevant primary argument, and dispatches to the
 * appropriate category-specific view:
 *
 * - **Shell** — terminal-style command block
 * - **File (read/write/edit/delete)** — file icon + path + optional content
 * - **Search / List** — pattern display
 * - **MCP** — metadata row + scalar key-value grid + collapsible JSON
 * - **Generic / Unknown** — formatted JSON args
 *
 * @example
 * ```tsx
 * // In approval card (from argsPreview string):
 * const args = JSON.parse(pendingApproval.argsPreview);
 * <ToolArgsView toolName={toolName} args={args} mcpServerSlug={slug} />
 *
 * // In detail view (from ToolCall):
 * <ToolArgsView toolName={tc.name} args={tc.args} mcpServerSlug={tc.mcpServerSlug} />
 * ```
 */
export function ToolArgsView({
  toolName,
  args,
  mcpServerSlug,
  showFileName = true,
  className,
}: ToolArgsViewProps) {
  const categoryInfo = useMemo(
    () => resolveToolCategory(toolName, mcpServerSlug),
    [toolName, mcpServerSlug],
  );

  const primaryArg = useMemo(
    () => extractPrimaryArgValue(args, categoryInfo),
    [args, categoryInfo],
  );

  return (
    <div className={cn("text-xs", className)}>
      <CategoryArgsDispatch
        category={categoryInfo.category}
        toolName={toolName}
        args={args}
        primaryArg={primaryArg}
        mcpServerSlug={mcpServerSlug}
        showFileName={showFileName}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function CategoryArgsDispatch({
  category,
  toolName,
  args,
  primaryArg,
  mcpServerSlug,
  showFileName,
}: {
  category: ToolCategory;
  toolName: string;
  args: Record<string, unknown> | null;
  primaryArg: string | null;
  mcpServerSlug?: string;
  showFileName: boolean;
}) {
  switch (category) {
    case "shell":
      return primaryArg ? <ShellArgsView command={primaryArg} /> : null;

    case "read":
    case "write":
    case "edit":
    case "delete":
      return primaryArg ? (
        <FileArgsView
          path={primaryArg}
          category={category}
          args={args}
          showFileName={showFileName}
        />
      ) : null;

    case "search":
    case "list":
      return primaryArg ? <SearchArgsView pattern={primaryArg} /> : null;

    case "mcp":
      return (
        <McpArgsPreview
          toolName={toolName}
          args={args}
          mcpServerSlug={mcpServerSlug ?? ""}
        />
      );

    default:
      return args && Object.keys(args).length > 0 ? (
        <GenericArgsView args={args} />
      ) : null;
  }
}

// ---------------------------------------------------------------------------
// Category-specific views
// ---------------------------------------------------------------------------

function ShellArgsView({ command }: { command: string }) {
  const normalize = useSandboxNormalize();
  return (
    <div className="rounded-md border border-border bg-[var(--stgm-terminal-bg,#1a1a2e)] p-2.5">
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--stgm-terminal-fg,#e0e0e0)]">
        <span className="select-none text-[var(--stgm-terminal-prompt,#6b7280)]">
          ${" "}
        </span>
        {normalize(command)}
      </pre>
    </div>
  );
}

function FileArgsView({
  path,
  category,
  args,
  showFileName = true,
}: {
  path: string;
  category: string;
  args: Record<string, unknown> | null;
  showFileName?: boolean;
}) {
  const writeContent = useMemo(() => {
    if (category !== "write" && category !== "edit") return null;
    if (!args) return null;
    return extractWriteContentFromArgs(args);
  }, [category, args]);

  return (
    <div className="space-y-1.5">
      {showFileName && (
        <div className="flex items-center gap-1.5 text-xs">
          <FilePathIcon />
          <FilePathLink path={path} className="text-xs" />
        </div>
      )}
      {writeContent && (
        <CollapsibleCode label="Content" content={writeContent} />
      )}
    </div>
  );
}

function SearchArgsView({ pattern }: { pattern: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Pattern:</span>
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
        {pattern}
      </code>
    </div>
  );
}

function McpArgsPreview({
  toolName,
  args,
  mcpServerSlug,
}: {
  toolName: string;
  args: Record<string, unknown> | null;
  mcpServerSlug: string;
}) {
  return (
    <div className="space-y-2">
      <McpMetadataRow
        mcpServerSlug={mcpServerSlug}
        toolName={toolName}
        duration={null}
      />
      {args && Object.keys(args).length > 0 && <McpArgsView args={args} />}
    </div>
  );
}

function GenericArgsView({ args }: { args: Record<string, unknown> }) {
  return (
    <CollapsibleCode label="Arguments" content={formatJson(args)} />
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const WRITE_CONTENT_FIELDS = [
  "contents",
  "content",
  "file_content",
  "new_text",
  "new_string",
  "replacement",
] as const;

function extractWriteContentFromArgs(
  args: Record<string, unknown>,
): string | null {
  for (const field of WRITE_CONTENT_FIELDS) {
    const val = args[field];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

function extractPrimaryArgValue(
  args: Record<string, unknown> | null,
  info: ToolCategoryInfo,
): string | null {
  if (!args) return null;

  const tryField = (field: string): string | null => {
    const val = args[field];
    if (typeof val === "string" && val.length > 0) return val;
    return null;
  };

  if (info.primaryArgField) {
    const v = tryField(info.primaryArgField);
    if (v) return v;
  }

  for (const fb of info.fallbackArgFields) {
    const v = tryField(fb);
    if (v) return v;
  }

  if (info.category === "unknown" || info.category === "mcp") {
    const keys = Object.keys(args);
    if (keys.length > 0) {
      const val = args[keys[0]];
      if (typeof val === "string") return val;
    }
  }

  return null;
}
