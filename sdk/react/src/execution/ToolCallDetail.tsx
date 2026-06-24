"use client";

import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ToolResultView } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { McpToolDetail } from "./McpToolDetail";
import { ToolArgsView } from "./ToolArgsView";
import { ResultView } from "./ResultView";
import { useToolPresentation } from "./tool-presenter";
import type { ToolCategory } from "./tool-categories";
import { CollapsiblePre } from "./tool-rendering-primitives";
import { describeApprovalPolicySource } from "./approval-provenance";

/** Props for {@link ToolCallDetail}. */
export interface ToolCallDetailProps {
  /** The tool call to render in detail. */
  readonly toolCall: ToolCall;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders the detail panel for a single tool call with category-specific
 * treatments.
 *
 * Arguments render through the shared {@link ToolArgsView} (same component used
 * by {@link ApprovalCard}); results render through {@link ResultView}, driven by
 * `@stigmer/sdk`'s `normalizeToolResult` — so an edit shows a diff, a shell shows
 * a terminal with an exit badge, a search shows a match list, and unknown tools
 * degrade to readable JSON instead of a raw dump.
 *
 * Composition varies by category to avoid redundancy: an edit shows only the
 * diff (which already names the file and quantifies the change); a write shows
 * its input content; a read shows just the path.
 *
 * Importable on its own by platform builders composing custom tool UIs.
 *
 * @example
 * ```tsx
 * <ToolCallDetail toolCall={toolCall} />
 * ```
 */
export function ToolCallDetail({ toolCall, className }: ToolCallDetailProps) {
  const { category, result } = useToolPresentation(toolCall);

  return (
    <div className={cn("space-y-2 text-xs", className)}>
      <CategoryDetail toolCall={toolCall} category={category} result={result} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category composition
//
// Each category composes from three parts: MetadataRow (duration, slug),
// ToolArgsView (the input), and ResultView (the effect). The combination is
// chosen to be informative without duplication.
// ---------------------------------------------------------------------------

function CategoryDetail({
  toolCall,
  category,
  result,
}: {
  toolCall: ToolCall;
  category: ToolCategory;
  result: ToolResultView;
}) {
  const args = <ArgsSection toolCall={toolCall} />;

  switch (category) {
    case "think":
      return <ThinkToolDetail toolCall={toolCall} />;

    case "mcp":
      return <McpToolDetail toolCall={toolCall} />;

    case "edit":
      // The diff already names the file and quantifies the change, so it stands
      // alone — showing the new content as an argument would duplicate it.
      return (
        <>
          <MetadataRow toolCall={toolCall} />
          <ResultView view={result} />
        </>
      );

    case "read":
    case "write":
    case "delete":
      // The input is the point (path, or path + written content). Only surface a
      // result body when it carries new information — i.e. an error.
      return (
        <>
          <MetadataRow toolCall={toolCall} />
          {args}
          {result.type === "error" && <ResultView view={result} />}
        </>
      );

    default:
      // shell, search, list, fetch, web-search, unknown: input + effect.
      return (
        <>
          <MetadataRow toolCall={toolCall} />
          {args}
          <ResultView view={result} />
        </>
      );
  }
}

function ArgsSection({ toolCall }: { toolCall: ToolCall }) {
  return (
    <ToolArgsView
      toolName={toolCall.name}
      args={toolCall.args as Record<string, unknown> | null}
      mcpServerSlug={toolCall.mcpServerSlug}
    />
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

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function MetadataRow({ toolCall }: { toolCall: ToolCall }) {
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  // Authorization provenance the runner stamped onto the tool call
  // (approval_policy_source). Explains how this side effect was authorized —
  // gated and approved, or cleared by a lease / run-wide bypass. Empty for
  // legacy executions and ungated read-only tools.
  const provenance = describeApprovalPolicySource(toolCall.approvalPolicySource);
  const hasMetadata = toolCall.mcpServerSlug || duration || provenance;
  if (!hasMetadata) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
      {toolCall.mcpServerSlug && (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
          {toolCall.mcpServerSlug}
        </span>
      )}
      {duration && <span>{duration}</span>}
      {provenance && <span className="italic">{provenance}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable duration string from two ISO 8601 timestamps, or
 * `null` when either timestamp is empty or invalid.
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
