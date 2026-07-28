/**
 * Review renderer tour — a single beat of the real `WorkflowTaskReviewGate`
 * on a surface that registered a custom `article-diff` renderer, for
 * `docs/guides/workflows/review-payloads.mdx` ("a registered renderer
 * presents it as a diff").
 *
 * Its sibling `review-fallback-tour` shows the same gate on a surface with
 * no renderers; the gate's identity (task, hint, outcomes, payload) lives in
 * `_shared/article-review.ts` so the page's "same payload, same ui_hint"
 * promise holds by construction. The renderer itself is tour-local — it
 * plays the embedding app's own component, which is the guide's point.
 *
 * Ported from the `review-payload-gate` docs inline demo (its
 * `ReviewPayloadRenderer` export).
 */
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The single surface this tour shows (one branch in `renderStep`). */
export type ReviewRendererTourStep = { view: "renderer-gate" };

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const reviewRendererTourSteps: ScenarioStep<ReviewRendererTourStep>[] = [
  {
    // Floor for muted playback; narration extends the beat when it runs
    // longer. Step 0 is interaction-free by rule, so this beat holds a
    // steady frame of the rendered diff.
    delayMs: 6000,
    data: { view: "renderer-gate" },
    // The steady frame doubles as the still on
    // docs/guides/workflows/review-payloads (its
    // <Still id="review-renderer-tour/renderer-gate">). That reference is why
    // this tour must stay in the repo even with no <ScenarEmbed> left —
    // verify-scenar-tours invariant 8 holds the two sides together.
    shot: "renderer-gate",
    narration:
      "The gate carries the revision as its payload, tagged article diff — " +
      "and because this surface registered a renderer for that hint, the " +
      "reviewer sees the change as a diff, rendered by the app's own component.",
  },
];
