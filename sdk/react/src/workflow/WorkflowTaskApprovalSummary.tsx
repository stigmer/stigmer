"use client";

import { memo, useMemo } from "react";
import Markdown from "react-markdown";
import type { JsonObject } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS } from "../internal/markdown-components.js";
import { formatDuration, formatTimestamp } from "./format-utils.js";
import type { TaskOutcome } from "./WorkflowTaskApprovalCard.js";
import type { TaskDetailApprovalDecision } from "./execution-inspector/index.js";

/** Props for {@link WorkflowTaskApprovalSummary}. */
export interface WorkflowTaskApprovalSummaryProps {
  /** Name of the human_input task whose decision is being summarized. */
  readonly taskName: string;
  /**
   * Resolved prompt text from the workflow's human_input task config.
   * Rendered as markdown so reviewers can see what was decided on.
   */
  readonly prompt?: string;
  /**
   * Configured outcomes from the workflow definition. Used to resolve the
   * chosen outcome's human-readable label. When empty, the raw outcome
   * identifier is shown.
   */
  readonly outcomes: readonly TaskOutcome[];
  /**
   * The recorded decision, sourced from the canonical task output. When
   * `null` — or when its `outcome` is still empty — the gate has been
   * resolved but the decision record has not yet materialized in the
   * status snapshot; a "finalizing" affordance is shown instead.
   */
  readonly decision: TaskDetailApprovalDecision | null;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Read-only decision report for a resolved workflow human_input gate.
 *
 * Renders the prompt, the chosen outcome, the reviewer and timing, and any
 * comment or form answers captured with the decision — sourced entirely
 * from the canonical task-output record (see `derive-task-detail`). This is
 * the resolved counterpart to {@link WorkflowTaskApprovalCard}: the card
 * collects a decision while a gate is `waiting_approval`; this component
 * presents the decision once it is made, so the Approval tab never offers
 * an already-answered gate for a second decision.
 *
 * Designed for embedding in both the Stigmer Console and third-party
 * dashboards — no routing, auth, or app-shell dependencies (DD-004). All
 * visual properties flow through `--stgm-*` tokens (DD-005).
 *
 * @example
 * ```tsx
 * <WorkflowTaskApprovalSummary
 *   taskName="team_lead_review"
 *   prompt="Review today's notification plan."
 *   outcomes={[{ name: "approve", label: "Approve Plan" }]}
 *   decision={detail.approval.decision}
 * />
 * ```
 */
export const WorkflowTaskApprovalSummary = memo(function WorkflowTaskApprovalSummary({
  taskName,
  prompt,
  outcomes,
  decision,
  className,
}: WorkflowTaskApprovalSummaryProps) {
  const isFinalizing = !decision || decision.outcome === "";

  const outcomeLabel = useMemo(() => {
    if (!decision || !decision.outcome) return "";
    const match = outcomes.find((o) => o.name === decision.outcome);
    return match?.label || capitalize(decision.outcome.replace(/_/g, " "));
  }, [decision, outcomes]);

  const tone: DecisionTone = useMemo(
    () => (decision && !isFinalizing ? resolveTone(decision.outcome) : "neutral"),
    [decision, isFinalizing],
  );

  const formEntries = useMemo(() => extractFormEntries(decision?.formData ?? null), [decision]);

  return (
    <div
      role="group"
      aria-label={`Approval decision for ${taskName}`}
      className={cn("mt-2 rounded-lg border border-border bg-muted-subtle p-3", className)}
    >
      {/* Decision header */}
      {isFinalizing ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <SpinnerIcon />
          <span>Decision recorded — finalizing…</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
              TONE_CLASSES[tone],
            )}
          >
            <ToneIcon tone={tone} />
            {outcomeLabel}
          </span>
          {decision!.autoResolved && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              auto-resolved
            </span>
          )}
        </div>
      )}

      {/* Reviewer + timing */}
      {!isFinalizing && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          {decision!.reviewer && (
            <span>
              by <span className="font-medium text-foreground">{decision!.reviewer}</span>
            </span>
          )}
          {decision!.respondedAt && (
            <>
              {decision!.reviewer && <Dot />}
              <span className="tabular-nums">{formatTimestamp(decision!.respondedAt)}</span>
            </>
          )}
          {decision!.waitDurationMs > 0 && (
            <>
              {(decision!.reviewer || decision!.respondedAt) && <Dot />}
              <span className="tabular-nums">waited {formatDuration(decision!.waitDurationMs)}</span>
            </>
          )}
        </div>
      )}

      {/* What was decided on */}
      {prompt && (
        <div className="mt-3 max-h-80 overflow-y-auto rounded border border-border bg-background p-3">
          <div className="stgm-prose">
            <Markdown components={MARKDOWN_COMPONENTS} remarkPlugins={REMARK_PLUGINS}>
              {prompt}
            </Markdown>
          </div>
        </div>
      )}

      {/* Reviewer comment */}
      {!isFinalizing && decision!.comment && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Comment
          </p>
          <p className="whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs text-foreground">
            {decision!.comment}
          </p>
        </div>
      )}

      {/* Submitted form answers */}
      {!isFinalizing && formEntries.length > 0 && (
        <dl className="mt-3 space-y-2">
          {formEntries.map((entry) => (
            <div key={entry.key}>
              <dt className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {entry.label}
              </dt>
              <dd className="whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs text-foreground">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Tone (visual treatment of the chosen outcome)
// ---------------------------------------------------------------------------

type DecisionTone = "approve" | "reject" | "neutral";

const TONE_CLASSES: Record<DecisionTone, string> = {
  approve: "bg-success-subtle text-success",
  reject: "bg-destructive-subtle text-destructive",
  neutral: "bg-muted text-foreground",
};

/**
 * Maps an outcome identifier to a visual tone. Reject/deny outcomes read
 * as destructive; approve/accept as success; everything else neutral.
 * Color is never the sole signal — the outcome label is always shown.
 */
function resolveTone(outcome: string): DecisionTone {
  const lower = outcome.toLowerCase();
  if (lower.includes("reject") || lower.includes("deny") || lower.includes("decline")) {
    return "reject";
  }
  if (lower.includes("approve") || lower.includes("accept") || lower === "yes") {
    return "approve";
  }
  return "neutral";
}

// ---------------------------------------------------------------------------
// Form answer extraction
// ---------------------------------------------------------------------------

interface FormEntry {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/** Flattens a form-data object into displayable label/value entries. */
function extractFormEntries(formData: JsonObject | null): FormEntry[] {
  if (!formData) return [];
  return Object.entries(formData).map(([key, raw]) => ({
    key,
    label: capitalize(key.replace(/_/g, " ")),
    value: stringifyValue(raw),
  }));
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function Dot() {
  return <span aria-hidden="true">·</span>;
}

function ToneIcon({ tone }: { readonly tone: DecisionTone }) {
  if (tone === "reject") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
      </svg>
    );
  }
  if (tone === "approve") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <path d="M2.5 6.5l2.5 2.5 4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <circle cx="6" cy="6" r="4" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}
