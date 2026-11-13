"use client";

import { memo, useMemo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@stigmer/design-tokens";
import {
  PLAN_DOCUMENT_MARKDOWN_COMPONENTS,
  extractLeadingH1,
  unwrapEnclosingMarkdownFence,
} from "../internal/markdown-components.js";
import { PlanCard } from "./PlanCard.js";
import { useBuildFromPlanHotkey } from "./use-build-from-plan-hotkey.js";

/** Props for {@link PlanDocumentMessage}. */
export interface PlanDocumentMessageProps {
  /** The plan message's markdown content (the agent's final Plan-mode reply). */
  readonly content: string;
  /**
   * Builds from the plan: a Build primary on the plan's own card, with the
   * card-scoped `Cmd/Ctrl+Enter` accelerator. Pass it to the latest plan
   * only; no Build when omitted (a host that passes it here draws no
   * separate `PlanCompletionCard`, so the plan shows once).
   */
  readonly onImplement?: () => void;
  /** Disables Build (e.g., while a run is active). */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a Plan-mode turn's plan as a first-class document instead of a chat
 * bubble: the thread's one plan card, its header the list glyph and the
 * plan's title (its leading `# H1`, lifted out of the prose, else "Plan"),
 * the plan under it in document-grade typography
 * ({@link PLAN_DOCUMENT_MARKDOWN_COMPONENTS}), and Build when `onImplement`
 * is given.
 *
 * This is the thread's NO-PLAN-FILE fallback: a completed Plan turn that never
 * published `plan.md` (older runs, a failed upload) keeps its plan
 * inline via this component — the message is the only copy of the plan, so it
 * must stay readable in place. A turn that DID return the plan File collapses
 * its plan message into the compact `PlanFileCard` instead, and the
 * document renders in the session panel's plan tab (`PlanEditor`) with the
 * same typography.
 *
 * Fence handling is plan-scoped: a plan wrapped in a whole-body fence is
 * unwrapped even when the fence carries no language tag (`allowBareFence`) —
 * a Plan turn's output is a markdown document by contract, so an enclosing
 * bare fence is wrapping, not code. Render-time only; the transcript and the
 * plan File stay byte-faithful.
 *
 * Purely presentational — no data fetching, no state.
 * All visual properties flow through `--stgm-*` tokens.
 */
export const PlanDocumentMessage = memo(function PlanDocumentMessage({
  content,
  onImplement,
  disabled,
  className,
}: PlanDocumentMessageProps) {
  const { title, body } = useMemo(
    () => extractLeadingH1(unwrapEnclosingMarkdownFence(content, true)),
    [content],
  );
  const handleKeyDown = useBuildFromPlanHotkey(onImplement, disabled);

  return (
    <PlanCard
      role="article"
      aria-label="Plan document"
      onKeyDown={handleKeyDown}
      state="text"
      title={title ?? "Plan"}
      body={
        <div className="stgm-prose">
          <Streamdown
            components={PLAN_DOCUMENT_MARKDOWN_COMPONENTS}
            isAnimating={false}
          >
            {body}
          </Streamdown>
        </div>
      }
      build={onImplement === undefined ? undefined : { onClick: onImplement, disabled }}
      className={cn("stg:mx-4", className)}
    />
  );
});
