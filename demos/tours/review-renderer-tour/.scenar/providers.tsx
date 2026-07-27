/**
 * Providers for review-renderer-tour. `scenar pack` and `scenar render` wrap
 * every step of this tour in the exported `PreviewProviders`.
 *
 * The gate is fully prop-driven — no RPC fixtures. What this tour's surface
 * contributes is the renderer registration: the `article-diff` map handed to
 * `StigmerProvider`, exactly the wiring the review-payloads guide teaches.
 * (Its sibling `review-fallback-tour` registers none — that difference IS
 * the two tours' story.)
 */
import type { ReviewRenderers } from "@stigmer/react";
import { createStigmerPreview } from "../../_shared/stigmer-preview";
import { UI_HINT } from "../../_shared/article-review";
import { ArticleDiffRenderer } from "../article-diff-renderer";

// Module constant, exactly as the guide instructs: the registry must be
// referentially stable or every mounted gate re-renders on each pass.
const REVIEW_RENDERERS: ReviewRenderers = {
  [UI_HINT]: ArticleDiffRenderer,
};

export const PreviewProviders = createStigmerPreview(() => {}, {
  reviewRenderers: REVIEW_RENDERERS,
});
