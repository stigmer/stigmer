"use client";

import { memo, useMemo } from "react";
import Markdown from "react-markdown";
import type { JsonObject } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS } from "../internal/markdown-components.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { formatDuration, formatTimestamp } from "./format-utils.js";
import type { TaskOutcome } from "./WorkflowTaskApprovalCard.js";
import {
  deriveTaskReviewer,
  type TaskDetailApprovalDecision,
  type TaskReviewerView,
} from "./task-detail/task-approval.js";

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
 * from the canonical task-output record (see `task-detail/task-approval`).
 * This is the resolved counterpart to {@link WorkflowTaskApprovalCard}: the
 * card collects a decision while a gate is `waiting_approval`; this
 * component presents the decision once it is made, so a settled gate is
 * never offered for a second decision.
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

  const reviewer = useMemo(
    () => (decision ? deriveTaskReviewer(decision) : null),
    [decision],
  );

  return (
    <div
      role="group"
      aria-label={`Approval decision for ${taskName}`}
      className={cn("stg:mt-2 stg:rounded-lg stg:border stg:border-border stg:bg-muted-subtle stg:p-3", className)}
    >
      {/* Decision header */}
      {isFinalizing ? (
        <div className="stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-muted-foreground">
          <SpinnerIcon />
          <span>Decision recorded — finalizing…</span>
        </div>
      ) : (
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1">
          <span
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-2 stg:py-1 stg:text-xs stg:font-medium",
              TONE_CLASSES[tone],
            )}
          >
            <ToneIcon tone={tone} />
            {outcomeLabel}
          </span>
          {decision!.autoResolved && (
            <span className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-muted-foreground">
              auto-resolved
            </span>
          )}
        </div>
      )}

      {/* Reviewer + timing */}
      {!isFinalizing && (
        <div className="stg:mt-1.5 stg:flex stg:flex-wrap stg:items-center stg:gap-x-1.5 stg:text-[11px] stg:text-muted-foreground">
          {reviewer && <ReviewerChip reviewer={reviewer} />}
          {decision!.respondedAt && (
            <>
              {reviewer && <Dot />}
              <span className="stg:tabular-nums">{formatTimestamp(decision!.respondedAt)}</span>
            </>
          )}
          {decision!.waitDurationMs > 0 && (
            <>
              {(reviewer || decision!.respondedAt) && <Dot />}
              <span className="stg:tabular-nums">waited {formatDuration(decision!.waitDurationMs)}</span>
            </>
          )}
        </div>
      )}

      {/* What was decided on */}
      {prompt && (
        <div className="stg:mt-3 stg:max-h-80 stg:overflow-y-auto stg:rounded stg:border stg:border-border stg:bg-background stg:p-3">
          <div className="stgm-prose">
            <Markdown components={MARKDOWN_COMPONENTS} remarkPlugins={REMARK_PLUGINS}>
              {prompt}
            </Markdown>
          </div>
        </div>
      )}

      {/* Reviewer comment */}
      {!isFinalizing && decision!.comment && (
        <div className="stg:mt-3">
          <p className="stg:mb-1 stg:text-[11px] stg:font-medium stg:uppercase stg:tracking-wide stg:text-muted-foreground">
            Comment
          </p>
          <p className="stg:whitespace-pre-wrap stg:rounded stg:border stg:border-border stg:bg-background stg:p-2 stg:text-xs stg:text-foreground">
            {decision!.comment}
          </p>
        </div>
      )}

      {/* Submitted form answers */}
      {!isFinalizing && formEntries.length > 0 && (
        <dl className="stg:mt-3 stg:space-y-2">
          {formEntries.map((entry) => (
            <div key={entry.key}>
              <dt className="stg:mb-1 stg:text-[11px] stg:font-medium stg:uppercase stg:tracking-wide stg:text-muted-foreground">
                {entry.label}
              </dt>
              <dd className="stg:whitespace-pre-wrap stg:rounded stg:border stg:border-border stg:bg-background stg:p-2 stg:text-xs stg:text-foreground">
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
// Reviewer chip
// ---------------------------------------------------------------------------

/**
 * `by <avatar> Ada Lovelace` — the reviewer's display identity, following
 * the platform's actor pattern (see `WorkflowVersionTimeline`). The email
 * rides on the house tooltip when it is not already the visible label. A
 * label that fell through to the raw identity (legacy records) renders
 * de-emphasized — internal IDs are never presented as if they were names.
 */
function ReviewerChip({ reviewer }: { readonly reviewer: TaskReviewerView }) {
  const nameClass = cn(
    reviewer.isRawId
      ? "stg:font-mono stg:text-[10px] stg:text-muted-foreground"
      : "stg:font-medium stg:text-foreground",
  );

  return (
    <span className="stg:flex stg:items-center stg:gap-1">
      by{" "}
      {reviewer.avatar && (
        <img src={reviewer.avatar} alt="" className="stg:size-3.5 stg:rounded-full" />
      )}
      {reviewer.email ? (
        <Tooltip>
          <TooltipTrigger render={<span className={nameClass} />}>
            {reviewer.label}
          </TooltipTrigger>
          <TooltipContent side="top">{reviewer.email}</TooltipContent>
        </Tooltip>
      ) : (
        <span className={nameClass}>{reviewer.label}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tone (visual treatment of the chosen outcome)
// ---------------------------------------------------------------------------

type DecisionTone = "approve" | "reject" | "neutral";

const TONE_CLASSES: Record<DecisionTone, string> = {
  approve: "stg:bg-success-subtle stg:text-success",
  reject: "stg:bg-destructive-subtle stg:text-destructive",
  neutral: "stg:bg-muted stg:text-foreground",
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
      className="stg:animate-spin"
      aria-hidden="true"
    >
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}
