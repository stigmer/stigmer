/**
 * Review fallback tour — a single beat of the real `WorkflowTaskReviewGate`
 * on a surface with NO registered renderers, for
 * `docs/guides/workflows/review-payloads.mdx` ("the built-in approval card
 * renders instead, showing the payload as structured data").
 *
 * Its sibling `review-renderer-tour` shows the same gate through a custom
 * `article-diff` renderer; the gate's identity (task, hint, outcomes,
 * payload) lives in `_shared/article-review.ts` so the page's "same payload,
 * same ui_hint" promise holds by construction.
 *
 * Ported from the `review-payload-gate` docs inline demo (its
 * `ReviewPayloadFallback` export).
 */
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The single surface this tour shows (one branch in `renderStep`). */
export type ReviewFallbackTourStep = { view: "fallback-gate" };

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const reviewFallbackTourSteps: ScenarioStep<ReviewFallbackTourStep>[] = [
  {
    // Floor for muted playback; narration extends the beat when it runs
    // longer. Step 0 is interaction-free by rule, so this beat holds a
    // steady frame of the built-in card.
    delayMs: 6000,
    data: { view: "fallback-gate" },
    narration:
      "The same gate, same payload, same hint — on a surface with no " +
      "registered renderers. The built-in card presents the payload as " +
      "structured data, so the workflow stays portable; the hint only " +
      "upgrades presentation where a renderer exists.",
  },
];
