"use client";

import { memo, useCallback } from "react";
import type { JsonValue } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { useReviewRenderer } from "./ReviewRendererContext.js";
import { useReviewPayload } from "./useReviewPayload.js";
import {
  WorkflowTaskApprovalCard,
  type TaskOutcome,
} from "./WorkflowTaskApprovalCard.js";

/** Props for {@link WorkflowTaskReviewGate}. */
export interface WorkflowTaskReviewGateProps {
  /** Name of the human_input task awaiting a decision. */
  readonly taskName: string;
  /** Resolved prompt text from the task config, rendered as markdown. */
  readonly prompt?: string;
  /** Configured outcomes; empty falls back to Approve / Reject. */
  readonly outcomes: readonly TaskOutcome[];
  /** JSON Schema for the reviewer's input form, when the gate defines one. */
  readonly formSchema?: Record<string, unknown>;
  /** Inline review payload from the approval_requested event, or `null`. */
  readonly payload?: JsonValue | null;
  /** Renderer discriminator from the task config's `ui_hint`. */
  readonly uiHint?: string;
  /** Artifact reference when the payload was promoted, or `null`. */
  readonly payloadArtifactId?: string | null;
  /**
   * Called when the reviewer submits a decision. The consumer (typically
   * {@link WorkflowExecutionViewer}) wires this to
   * `useWorkflowExecutionActions().submitTaskApproval`.
   */
  readonly onSubmit: (
    taskName: string,
    outcome: string,
    formData?: Record<string, unknown>,
    comment?: string,
  ) => Promise<unknown>;
  /** True while this gate's submission RPC is in flight. */
  readonly isSubmitting: boolean;
  /** This gate's last failed decision, or `null`. */
  readonly error?: Error | null;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The single decision surface for a pending workflow human_input gate.
 *
 * Owns the two review-payload concerns that sit above the approval card
 * (issue #234):
 *
 * 1. **Payload materialization** — inline payloads pass straight through;
 *    artifact-backed payloads are fetched via the API-proxied
 *    `artifact.getContent` (see {@link useReviewPayload}), with loading
 *    and error states rendered here so custom renderers always receive
 *    resolved data.
 * 2. **Renderer dispatch** — when the gate's `ui_hint` matches a renderer
 *    registered through `StigmerProvider`'s `reviewRenderers`, the host
 *    application's component presents the review; otherwise the built-in
 *    {@link WorkflowTaskApprovalCard} renders with the payload shown as
 *    structured data. An unrecognized hint never blocks the gate.
 *
 * Both mount points — the execution inspector's Approval tab and the
 * timeline's inline event card — render this component, so custom
 * renderers light up everywhere a gate appears without per-surface wiring.
 */
export const WorkflowTaskReviewGate = memo(function WorkflowTaskReviewGate({
  taskName,
  prompt,
  outcomes,
  formSchema,
  payload = null,
  uiHint,
  payloadArtifactId = null,
  onSubmit,
  isSubmitting,
  error,
  className,
}: WorkflowTaskReviewGateProps) {
  const Renderer = useReviewRenderer(uiHint);
  const resolved = useReviewPayload(payload, payloadArtifactId ?? null);

  const submit = useCallback(
    (outcome: string, formData?: Record<string, unknown>, comment?: string) =>
      onSubmit(taskName, outcome, formData, comment),
    [onSubmit, taskName],
  );

  if (resolved.isLoading) {
    return <PayloadLoadingState taskName={taskName} className={className} />;
  }

  if (resolved.error) {
    return (
      <PayloadErrorState
        taskName={taskName}
        error={resolved.error}
        onRetry={resolved.refetch}
        className={className}
      />
    );
  }

  if (Renderer && resolved.payload !== null) {
    return (
      <div className={className}>
        <Renderer
          taskName={taskName}
          payload={resolved.payload}
          formSchema={formSchema ?? null}
          outcomes={outcomes}
          submit={submit}
          isSubmitting={isSubmitting}
          error={error ?? null}
        />
      </div>
    );
  }

  return (
    <WorkflowTaskApprovalCard
      taskName={taskName}
      prompt={prompt}
      outcomes={outcomes}
      formSchema={formSchema}
      payload={resolved.payload}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
      error={error}
      className={className}
    />
  );
});

// ---------------------------------------------------------------------------
// Payload resolution states (DD-006: never a blank screen)
// ---------------------------------------------------------------------------

function PayloadLoadingState({
  taskName,
  className,
}: {
  readonly taskName: string;
  readonly className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={`Loading review material for ${taskName}`}
      className={cn(
        "stg:mt-2 stg:rounded-lg stg:border stg:border-border-prominent stg:border-l-2 stg:border-l-warning stg:p-3",
        className,
      )}
    >
      <div className="stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-muted-foreground">
        <Spinner />
        Loading review material…
      </div>
    </div>
  );
}

function PayloadErrorState({
  taskName,
  error,
  onRetry,
  className,
}: {
  readonly taskName: string;
  readonly error: Error;
  readonly onRetry: () => void;
  readonly className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "stg:mt-2 stg:rounded-lg stg:border stg:border-border-prominent stg:border-l-2 stg:border-l-destructive stg:p-3",
        className,
      )}
    >
      <p className="stg:text-xs stg:font-medium stg:text-foreground">
        Could not load the review material for {taskName}
      </p>
      <p className="stg:mt-1 stg:break-words stg:text-xs stg:text-muted-foreground">{error.message}</p>
      <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
        The gate stays pending — retry to load the material before deciding.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "stg:mt-2 stg:rounded stg:border stg:border-border stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:text-foreground",
          "stg:transition-colors stg:hover:bg-muted",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        )}
      >
        Retry
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="stg:animate-spin"
      aria-hidden="true"
    >
      <circle
        cx="6"
        cy="6"
        r="5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.25"
      />
      <path
        d="M11 6a5 5 0 0 0-5-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
