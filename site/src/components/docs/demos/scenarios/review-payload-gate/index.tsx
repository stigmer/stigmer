"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { createConnectTransport } from "@connectrpc/connect-web";
import { Stigmer } from "@stigmer/sdk";
import {
  StigmerProvider,
  WorkflowTaskReviewGate,
  type ReviewRendererProps,
  type ReviewRenderers,
} from "@stigmer/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { DemoDetailShell } from "../../shared/DemoDetailShell";

// ---------------------------------------------------------------------------
// Shared fixture: the approval_requested data both demos present.
//
// The payload is diff-structured because that is what a real editorial
// workflow would attach: the pipeline computes the changes, the renderer
// only presents them. The same object flows through both demos — the
// custom renderer shows it as an article diff, the fallback card shows
// it as structured data.
// ---------------------------------------------------------------------------

const REVIEW_PAYLOAD = {
  articleTitle: "Introducing Stigmer Workflows",
  changeSummary: "Corrects the launch date and strengthens the durability claim.",
  changes: [
    {
      section: "Introduction",
      before: "Stigmer Workflows launch in early 2027.",
      after: "Stigmer Workflows launch in November 2026.",
    },
    {
      section: "Execution model",
      before: "Every step runs on a best-effort basis.",
      after: "Every step runs with durable, resumable execution.",
    },
  ],
};

const OUTCOMES = [
  { name: "approve", label: "Approve" },
  { name: "request_changes", label: "Request changes" },
] as const;

const TASK_NAME = "editorial_review";
const UI_HINT = "article-diff";

// ---------------------------------------------------------------------------
// The custom renderer — the component an embedding app would register.
// ---------------------------------------------------------------------------

type ArticleRevision = typeof REVIEW_PAYLOAD;

function ArticleDiffRenderer({
  payload,
  outcomes,
  submit,
  isSubmitting,
}: ReviewRendererProps) {
  const revision = payload as unknown as ArticleRevision;

  return (
    <div className="rounded-lg border border-border-prominent border-l-2 border-l-warning p-3">
      <p className="text-sm font-semibold text-foreground">{revision.articleTitle}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{revision.changeSummary}</p>

      <div className="mt-3 space-y-2">
        {revision.changes.map((change) => (
          <div key={change.section} className="rounded-md border border-border p-2">
            <p className="text-xs font-medium text-muted-foreground">{change.section}</p>
            <p className="mt-1 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-foreground line-through decoration-destructive/60">
              {change.before}
            </p>
            <p className="mt-1 rounded bg-success/10 px-1.5 py-0.5 text-xs text-foreground">
              {change.after}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        {outcomes.map((outcome, index) => (
          <button
            key={outcome.name}
            type="button"
            disabled={isSubmitting}
            onClick={() => void submit(outcome.name)}
            className={
              index === 0
                ? "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
                : "rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            }
          >
            {outcome.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Module constant, exactly as the guide instructs: the registry must be
// referentially stable or every mounted gate re-renders on each pass.
const REVIEW_RENDERERS: ReviewRenderers = {
  [UI_HINT]: ArticleDiffRenderer,
};

// ---------------------------------------------------------------------------
// Demo plumbing
// ---------------------------------------------------------------------------

/**
 * Mirrors `.scenar/providers.tsx` but registers the demo's review
 * renderers — the exact `StigmerProvider` wiring the guide teaches.
 * The payload is inline, so no request ever leaves the component and
 * no MSW fixtures are needed.
 */
function ReviewDemoProviders({ children }: { readonly children: ReactNode }) {
  const client = useMemo(() => {
    const transport = createConnectTransport({ baseUrl: "/", useBinaryFormat: false });
    return new Stigmer({ baseUrl: "/", customTransport: transport });
  }, []);

  return (
    <StigmerProvider client={client} reviewRenderers={REVIEW_RENDERERS}>
      {children}
    </StigmerProvider>
  );
}

/** Local decision state so readers can actually click through the gate. */
function useDemoDecision() {
  const [decision, setDecision] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = useCallback(async (_taskName: string, outcome: string) => {
    setIsSubmitting(true);
    // Brief pause so the in-flight (disabled) state is visible.
    await new Promise((resolve) => setTimeout(resolve, 400));
    setIsSubmitting(false);
    setDecision(outcome);
    return undefined;
  }, []);

  const reset = useCallback(() => setDecision(null), []);

  return { decision, isSubmitting, onSubmit, reset };
}

function DecisionRecorded({
  decision,
  onReset,
}: {
  readonly decision: string;
  readonly onReset: () => void;
}) {
  const label =
    OUTCOMES.find((outcome) => outcome.name === decision)?.label ?? decision;

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-sm font-medium text-foreground">
        Decision recorded: {label}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        The outcome flows through <code>submitWorkflowTaskApproval</code> and the
        workflow resumes on the matching branch.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-2 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        Reset demo
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported demos
// ---------------------------------------------------------------------------

/**
 * The gate with a registered `article-diff` renderer: the reviewer sees
 * the revision as an article diff, presented by the embedding app's own
 * component.
 */
export function ReviewPayloadRenderer() {
  const { decision, isSubmitting, onSubmit, reset } = useDemoDecision();

  return (
    <ReviewDemoProviders>
      <DemoDetailShell>
        <div className="p-4">
          {decision ? (
            <DecisionRecorded decision={decision} onReset={reset} />
          ) : (
            <WorkflowTaskReviewGate
              taskName={TASK_NAME}
              prompt="Review the proposed revision before publishing."
              outcomes={OUTCOMES}
              payload={REVIEW_PAYLOAD}
              uiHint={UI_HINT}
              onSubmit={onSubmit}
              isSubmitting={isSubmitting}
            />
          )}
        </div>
      </DemoDetailShell>
    </ReviewDemoProviders>
  );
}

/**
 * The same gate — same payload, same `ui_hint` — on a surface with no
 * registered renderers: the built-in approval card presents the payload
 * as structured data. This is the portability contract, live.
 */
export function ReviewPayloadFallback() {
  const { decision, isSubmitting, onSubmit, reset } = useDemoDecision();

  return (
    <PreviewProviders>
      <DemoDetailShell>
        <div className="p-4">
          {decision ? (
            <DecisionRecorded decision={decision} onReset={reset} />
          ) : (
            <WorkflowTaskReviewGate
              taskName={TASK_NAME}
              prompt="Review the proposed revision before publishing."
              outcomes={OUTCOMES}
              payload={REVIEW_PAYLOAD}
              uiHint={UI_HINT}
              onSubmit={onSubmit}
              isSubmitting={isSubmitting}
            />
          )}
        </div>
      </DemoDetailShell>
    </PreviewProviders>
  );
}
