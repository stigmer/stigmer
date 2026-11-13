"use client";

import { useMemo } from "react";
import { Streamdown } from "streamdown";
import {
  PLAN_DOCUMENT_MARKDOWN_COMPONENTS,
  extractLeadingH1,
} from "../internal/markdown-components.js";
import { PlanCardHeader, planSubline } from "../run/PlanCard.js";

/** Props for {@link PlanStreamingDocument}. */
export interface PlanStreamingDocumentProps {
  /**
   * The live plan text, already fence-stripped by `findStreamingPlan`
   * (`StreamingPlan.displayText`). Grows on every stream commit.
   */
  readonly displayText: string;
}

/**
 * The plan document tab's LIVE view: renders the plan as it streams, before
 * the plan File exists. The streaming counterpart of {@link PlanEditor} — same
 * centered document column, same header (the plan card's: list glyph, the
 * title lifted from the leading H1, else "Plan", and a subline), same
 * plan-document typography — so the moment the turn completes and the
 * File-backed editor takes over, the document simply stops moving rather
 * than changing shape.
 *
 * Deliberately capability-free: no view tabs, no Edit, no Build — a plan in
 * flight cannot be edited or implemented, and offering dead controls would
 * misstate the turn's state. The header's subline says "Writing the plan…",
 * a live status, pulsing unless motion is reduced.
 *
 * Rendering goes through `Streamdown` (the same streaming-aware renderer the
 * thread's `AiMessage` uses: block-level memoization, incomplete-syntax
 * healing, animated caret) rather than `PlanEditor`'s static markdown — this
 * component re-renders on every stream commit by design.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export function PlanStreamingDocument({
  displayText,
}: PlanStreamingDocumentProps) {
  const { title, body } = useMemo(
    () => extractLeadingH1(displayText),
    [displayText],
  );

  return (
    <div
      role="article"
      aria-label="Plan document"
      aria-busy="true"
      className="stg:mx-auto stg:flex stg:w-full stg:max-w-3xl stg:flex-col stg:gap-3 stg:px-4 stg:py-3"
    >
      <PlanCardHeader as="header" title={title ?? "Plan"} subline={planSubline("writing")} />

      <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border-muted stg:bg-card">
        <div className="stgm-prose stg:px-4 stg:py-4">
          <Streamdown
            components={PLAN_DOCUMENT_MARKDOWN_COMPONENTS}
            isAnimating
            caret="block"
          >
            {body}
          </Streamdown>
        </div>
      </div>
    </div>
  );
}
