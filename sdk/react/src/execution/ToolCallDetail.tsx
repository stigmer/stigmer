"use client";

import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { resolveToolCategory } from "./tool-categories";
import { McpToolDetail } from "./McpToolDetail";
import { useSandboxNormalize } from "./SandboxContext";
import { ToolArgsView } from "./ToolArgsView";
import {
  CollapsibleCode,
  CollapsiblePre,
  formatResult,
} from "./tool-rendering-primitives";

/** Props for {@link ToolCallDetail}. */
export interface ToolCallDetailProps {
  /** The tool call to render in detail. */
  readonly toolCall: ToolCall;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders the detail panel for a single tool call with
 * category-specific visual treatments.
 *
 * Arguments are rendered through the shared {@link ToolArgsView}
 * dispatch (same component used by {@link ApprovalCard}), ensuring
 * visual parity between pre-execution approval previews and
 * post-execution detail views. Result/output sections are layered
 * on top by this component.
 *
 * - **Shell tools**: terminal-style command + output
 * - **File tools (read/write/edit/delete)**: file path + content + result
 * - **Search tools (grep/glob)**: pattern + results
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
          <pre className="whitespace-pre-wrap break-words rounded-md border border-destructive/20 bg-destructive-subtle p-2 font-mono text-destructive">
            {toolCall.error}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category-specific renderers
//
// Each renderer composes:
//   MetadataRow (duration, slug) + ToolArgsView (shared args) + result section
//
// Think and MCP have fully custom rendering that doesn't fit the
// MetadataRow + ToolArgsView + Result pattern.
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

function ShellToolDetail({ toolCall }: { toolCall: ToolCall }) {
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const normalize = useSandboxNormalize();

  return (
    <>
      <MetadataRow toolCall={toolCall} duration={duration} />

      <ToolArgsView
        toolName={toolCall.name}
        args={toolCall.args as Record<string, unknown> | null}
        mcpServerSlug={toolCall.mcpServerSlug}
      />

      {toolCall.result && (
        <div className="space-y-1">
          <span className="font-medium text-muted-foreground">Output</span>
          <div className="rounded-md border border-border bg-[var(--stgm-terminal-bg,#1a1a2e)] p-2.5">
            <CollapsiblePre
              content={normalize(toolCall.result)}
              className="text-[var(--stgm-terminal-fg,#e0e0e0)]"
            />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * For **read**: metadata + path only (content is noise for the user).
 * For **write/edit/delete**: metadata + path + content (via ToolArgsView) + result.
 */
function FileToolDetail({
  toolCall,
  mode,
}: {
  toolCall: ToolCall;
  mode: "read" | "write" | "edit" | "delete";
}) {
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);

  return (
    <>
      <MetadataRow toolCall={toolCall} duration={duration} />

      <ToolArgsView
        toolName={toolCall.name}
        args={toolCall.args as Record<string, unknown> | null}
        mcpServerSlug={toolCall.mcpServerSlug}
      />

      {mode !== "read" && toolCall.result && (
        <CollapsibleCode
          label="Result"
          content={formatResult(toolCall.result)}
        />
      )}
    </>
  );
}

function SearchToolDetail({ toolCall }: { toolCall: ToolCall }) {
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);

  return (
    <>
      <MetadataRow toolCall={toolCall} duration={duration} />

      <ToolArgsView
        toolName={toolCall.name}
        args={toolCall.args as Record<string, unknown> | null}
        mcpServerSlug={toolCall.mcpServerSlug}
      />

      {toolCall.result && (
        <CollapsibleCode
          label="Results"
          content={formatResult(toolCall.result)}
        />
      )}
    </>
  );
}

function ThinkToolDetail({ toolCall }: { toolCall: ToolCall }) {
  const thought =
    (toolCall.args?.["thought"] as string | undefined) || toolCall.result;

  if (!thought) return null;

  return (
    <div className="rounded-md border border-border-muted bg-muted-faint p-3">
      <CollapsiblePre
        content={thought}
        className="italic text-muted-foreground whitespace-pre-wrap"
      />
    </div>
  );
}

function GenericToolDetail({ toolCall }: { toolCall: ToolCall }) {
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);

  return (
    <>
      <MetadataRow toolCall={toolCall} duration={duration} />

      <ToolArgsView
        toolName={toolCall.name}
        args={toolCall.args as Record<string, unknown> | null}
        mcpServerSlug={toolCall.mcpServerSlug}
      />

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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
