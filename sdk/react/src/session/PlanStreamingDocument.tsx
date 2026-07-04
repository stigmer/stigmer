"use client";

import { useMemo } from "react";
import { Streamdown } from "streamdown";
import {
  PLAN_DOCUMENT_MARKDOWN_COMPONENTS,
  extractLeadingH1,
} from "../internal/markdown-components.js";

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
 * any artifact exists. The streaming counterpart of {@link PlanEditor} — same
 * centered document column, same header-lifted title, same plan-document
 * typography — so the moment the turn completes and the artifact-backed
 * editor takes over, the document simply stops moving rather than changing
 * shape.
 *
 * Deliberately capability-free: no view tabs, no Edit, no Build — a plan in
 * flight cannot be edited or implemented, and offering dead controls would
 * misstate the turn's state. A "Writing…" status pill stands where the
 * editor's toolbar will appear.
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
      className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground"
        >
          <WritingDot />
          Writing…
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-muted bg-card">
        {title && (
          <header className="border-b border-border-muted bg-muted-faint px-4 py-2.5">
            <span className="block truncate text-sm font-semibold text-foreground">
              {title}
            </span>
          </header>
        )}
        <div className="stgm-prose px-4 py-4">
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

/**
 * The pill's pulsing dot — a CSS animation inside `.stgm`, covered by the
 * stylesheet's global `prefers-reduced-motion` rule (DD-015).
 */
function WritingDot() {
  return (
    <span
      aria-hidden="true"
      className="size-1.5 animate-pulse rounded-full bg-primary"
    />
  );
}
