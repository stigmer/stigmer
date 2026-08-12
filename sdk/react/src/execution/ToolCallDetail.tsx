"use client";

import { useMemo } from "react";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { toDisplayFileChange } from "@stigmer/sdk";
import type { ToolResultView } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { BoundedContent } from "../internal/BoundedContent.js";
import { FileChangeDiff } from "./FileChangesView.js";
import { useFileReviewRowChange } from "./FileReviewContext.js";
import { McpToolDetail } from "./McpToolDetail.js";
import { ToolArgsView } from "./ToolArgsView.js";
import { ResultView } from "./ResultView.js";
import { useToolPresentation } from "./tool-presenter.js";
import type { ToolCategory } from "./tool-categories.js";
import { CollapsiblePre } from "./tool-rendering-primitives.js";
import {
  describeApprovalPolicySource,
  isInformativePolicySource,
} from "./approval-provenance.js";

/** Props for {@link ToolCallDetail}. */
export interface ToolCallDetailProps {
  /** The tool call to render in detail. */
  readonly toolCall: ToolCall;
  /**
   * Whether the owning row's header truncated the primary argument (the search
   * query / list path). A header-owned layout fact: when `true`, the search/list
   * body restates the full, wrapping value so a long query is reachable without
   * relying on the hover tooltip; when `false` (the default) the header already
   * shows the value in full, so the body does not repeat it. Only the
   * search/list branch consumes it.
   */
  readonly primaryArgTruncated?: boolean;
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
 * diff (which already names the file and quantifies the change); a stamped
 * write shows its change set's captured diff, degrading to the proposed
 * content when no capture resolves; a read shows just the path.
 *
 * Importable on its own by platform builders composing custom tool UIs.
 *
 * @example
 * ```tsx
 * <ToolCallDetail toolCall={toolCall} />
 * ```
 */
export function ToolCallDetail({
  toolCall,
  primaryArgTruncated = false,
  className,
}: ToolCallDetailProps) {
  const { category, result, primaryArg } = useToolPresentation(toolCall);

  // The captured net change a stamped write row renders as its inline diff
  // (see the write branch below). Resolved here unconditionally (Rules of
  // Hooks); null for every other category's rows — they are never stamped —
  // and for every honest-degradation case, so this costs nothing outside the
  // stamped-write path.
  const capturedChange = useFileReviewRowChange(
    toolCall.fileChangeSetId,
    primaryArg,
  );

  return (
    <div className={cn("stg:space-y-2 stg:text-xs", className)}>
      <CategoryDetail
        toolCall={toolCall}
        category={category}
        result={result}
        primaryArg={primaryArg}
        primaryArgTruncated={primaryArgTruncated}
        capturedChange={capturedChange}
      />
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
  primaryArg,
  primaryArgTruncated,
  capturedChange,
}: {
  toolCall: ToolCall;
  category: ToolCategory;
  result: ToolResultView;
  primaryArg: string | null;
  primaryArgTruncated: boolean;
  capturedChange: CapturedFileChange | null;
}) {
  const args = <ArgsSection toolCall={toolCall} />;

  switch (category) {
    case "think":
      return <ThinkToolDetail toolCall={toolCall} />;

    case "mcp":
      return <McpToolDetail toolCall={toolCall} />;

    case "search":
    case "list":
      // The query/path is the input; the matches are the effect. The owning row
      // header already shows the query (truncated, with a hover tooltip), so the
      // body does NOT restate it as a redundant "Pattern:" row — it shows the
      // full, wrapping value only when the header truncated it (a long query),
      // then the result. This is the search/list analog of the edit branch's
      // "the diff already names the file" de-duplication.
      return (
        <>
          <ProvenanceNote toolCall={toolCall} />
          {primaryArgTruncated && primaryArg && (
            <SearchQueryBlock category={category} value={primaryArg} />
          )}
          {/* The owning row header shows the count (summarizeResultView), so the
              body suppresses it (showStats={false}) and shows only the matches
              plus, when capped, a truncation note. */}
          <ResultView view={result} showStats={false} />
        </>
      );

    case "edit":
    case "write": {
      // The diff already names the file and quantifies the change, so it stands
      // alone — showing the written content as an argument would duplicate it.
      // The owning row already names the file, so the body suppresses the path.
      //
      // An EDIT's diff is reconstructed per-call from its own args (old/new
      // strings, or the Cursor envelope's unified diff). A whole-file WRITE has
      // no per-call before-image in its args, so a stamped write renders the
      // captured NET change from its change set instead — the same artifact the
      // row's review badge refers to, resolved through the same path matcher so
      // the two can never disagree. An unresolvable write (still streaming
      // before the turn-boundary capture, no capture mode, legacy session, or a
      // non-reviewable change) keeps the honest fallback: the proposed content
      // from the args, as a `file` view.
      if (category === "write" && capturedChange) {
        return (
          <>
            <ProvenanceNote toolCall={toolCall} />
            <CapturedRowDiff change={capturedChange} />
          </>
        );
      }
      // Bounding is keyed on the VIEW, not the category: BoundedContent is for
      // bodies with no internal truncation of their own — the diff and a FAILED
      // call's error `<pre>` — giving a large or still-streaming edit the same
      // scannable clamp the approval gate uses. The `file` view self-truncates
      // (CollapsibleCode's line cap), so wrapping it would stack two reveal
      // controls on one block — exactly what BoundedContent's contract forbids.
      const body = (
        <ResultView view={result} showFileName={false} showStats={false} />
      );
      return (
        <>
          <ProvenanceNote toolCall={toolCall} />
          {result.type === "file" ? (
            body
          ) : (
            <BoundedContent cursorTarget="tool-detail-expand">
              {body}
            </BoundedContent>
          )}
        </>
      );
    }

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
      // fetch, web-search, unknown: input + effect.
      return (
        <>
          <ProvenanceNote toolCall={toolCall} />
          {args}
          <ResultView view={result} />
        </>
      );
  }
}

// The full, wrapping query (search) or path (list), shown in the body only when
// the owning row's header truncated it — so a long value is reachable without
// hovering, without restating a short value the header already shows in full.
function SearchQueryBlock({
  category,
  value,
}: {
  category: ToolCategory;
  value: string;
}) {
  const label = category === "list" ? "Path" : "Query";
  return (
    <div className="stg:space-y-1">
      <span className="stg:font-medium stg:text-muted-foreground">{label}</span>
      <code className="stg:block stg:whitespace-pre-wrap stg:break-words stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-foreground">
        {value}
      </code>
    </div>
  );
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
    <div className="stg:rounded-md stg:border stg:border-border-muted stg:bg-muted-faint stg:p-3">
      <CollapsiblePre
        content={thought}
        className="stg:italic stg:text-muted-foreground stg:whitespace-pre-wrap"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

// A stamped write row's inline diff: the captured change projected onto the
// display FileChange and rendered through the same bounded FileChangeDiff the
// review card's body uses — offloaded-body fetch, binary notices, and
// truncation states included. The file name is suppressed (the owning row
// header names it); the `+N −M` stats stay because a write row's header
// summary carries none.
function CapturedRowDiff({ change }: { change: CapturedFileChange }) {
  const adapted = useMemo(() => toDisplayFileChange(change), [change]);
  return <FileChangeDiff change={adapted} bounded showFileName={false} />;
}

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
    <p className="stg:text-[11px] stg:italic stg:text-muted-foreground">
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
