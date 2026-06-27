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
import {
  describeApprovalPolicySource,
  isInformativePolicySource,
} from "./approval-provenance";

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
// Invariant: the owning row header owns the METADATA (icon, label, file name,
// ± stats, MCP slug, status, duration); the detail body owns the CONTENT — the
// ToolArgsView input and the ResultView effect — plus, at most, a
// ProvenanceNote when the authorization provenance is genuinely informative.
// The body never restates header metadata. Each category picks the input/effect
// combination that is informative without duplication.
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
    case "write":
      // The diff already names the file and quantifies the change, so it stands
      // alone — showing the written content as an argument would duplicate it. A
      // write whose capture is unavailable degrades to a `file` result here
      // (ResultView shows the content), so the input is never lost. The owning
      // row already names the file, so the body suppresses the path.
      return (
        <>
          <ProvenanceNote toolCall={toolCall} />
          <ResultView view={result} showFileName={false} showStats={false} />
        </>
      );

    case "read":
    case "delete":
      // The input is the point (path, or path for a delete). Only surface a
      // result body when it carries new information — i.e. an error.
      return (
        <>
          <ProvenanceNote toolCall={toolCall} />
          {args}
          {result.type === "error" && <ResultView view={result} />}
        </>
      );

    case "shell":
      // The result IS a terminal session (command + output in one block via
      // ResultView's terminal view), so a separate args box would just restate
      // the command line the session already leads with. The exception is a
      // hard tool failure (TOOL_CALL_FAILED → error view, which has no command):
      // show the command (args) alongside the error so it is never lost.
      return (
        <>
          <ProvenanceNote toolCall={toolCall} />
          {result.type === "error" ? (
            <>
              {args}
              <ResultView view={result} />
            </>
          ) : (
            <ResultView view={result} />
          )}
        </>
      );

    default:
      // search, list, fetch, web-search, unknown: input + effect.
      return (
        <>
          <ProvenanceNote toolCall={toolCall} />
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

// The detail body's only metadata. Duration and the MCP slug live in the owning
// row header (ToolCallItem / ApprovalCardHeader), so the body never restates
// them; it surfaces the authorization provenance the runner stamped onto the
// call (approval_policy_source) ONLY when it is genuinely informative — an
// explicit override, a server-marked destructive tighten, or a post-hoc
// lease/bypass that cleared it. The everyday "this category just needs approval"
// default and legacy UNSPECIFIED are noise, so they render nothing, mirroring
// the approval gate's smart-suppress (isInformativePolicySource).
function ProvenanceNote({ toolCall }: { toolCall: ToolCall }) {
  if (!isInformativePolicySource(toolCall.approvalPolicySource)) return null;
  const provenance = describeApprovalPolicySource(toolCall.approvalPolicySource);
  if (!provenance) return null;

  return (
    <p
      className="text-[11px] italic text-muted-foreground"
      title={provenance}
    >
      {provenance}
    </p>
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
