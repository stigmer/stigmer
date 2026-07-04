"use client";

import { memo, useMemo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@stigmer/theme";
import {
  PLAN_DOCUMENT_MARKDOWN_COMPONENTS,
  extractLeadingH1,
  unwrapEnclosingMarkdownFence,
} from "../internal/markdown-components.js";

/** Props for {@link PlanDocumentMessage}. */
export interface PlanDocumentMessageProps {
  /** The plan message's markdown content (the agent's final Plan-mode reply). */
  readonly content: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a Plan-mode turn's plan as a first-class document instead of a chat
 * bubble: a bordered card with a title header (the plan's leading `# H1`,
 * lifted out of the prose) and document-grade typography
 * ({@link PLAN_DOCUMENT_MARKDOWN_COMPONENTS}).
 *
 * This is the thread's NO-ARTIFACT fallback: a completed Plan turn that never
 * published `plan.md` (older executions, a failed upload) keeps its plan
 * inline via this component — the message is the only copy of the plan, so it
 * must stay readable in place. A turn that DID publish the artifact collapses
 * its plan message into the compact `PlanArtifactCard` instead, and the
 * document renders in the session panel's plan tab (`PlanEditor`) with the
 * same typography.
 *
 * Fence handling is plan-scoped: a plan wrapped in a whole-body fence is
 * unwrapped even when the fence carries no language tag (`allowBareFence`) —
 * a Plan turn's output is a markdown document by contract, so an enclosing
 * bare fence is wrapping, not code. Render-time only; the transcript and the
 * published artifact stay byte-faithful.
 *
 * Purely presentational — no data fetching, no state.
 * All visual properties flow through `--stgm-*` tokens.
 */
export const PlanDocumentMessage = memo(function PlanDocumentMessage({
  content,
  className,
}: PlanDocumentMessageProps) {
  const { title, body } = useMemo(
    () => extractLeadingH1(unwrapEnclosingMarkdownFence(content, true)),
    [content],
  );

  return (
    <div
      role="article"
      aria-label="Plan document"
      className={cn("mx-4", className)}
    >
      <div className="overflow-hidden rounded-lg border border-border-muted bg-card">
        <header className="flex items-center gap-2 border-b border-border-muted bg-muted-faint px-4 py-2.5">
          <PlanDocIcon />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {title ?? "Plan"}
          </span>
        </header>
        <div className="stgm-prose px-4 py-4">
          <Streamdown
            components={PLAN_DOCUMENT_MARKDOWN_COMPONENTS}
            isAnimating={false}
          >
            {body}
          </Streamdown>
        </div>
      </div>
    </div>
  );
});

function PlanDocIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M3 4h10M3 8h7M3 12h8" />
      <path d="M12.5 10.5l1.5 1.5-1.5 1.5" />
    </svg>
  );
}
