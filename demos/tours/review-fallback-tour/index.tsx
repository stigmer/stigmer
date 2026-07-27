import type { CSSProperties, ReactNode } from "react";
import { WorkflowTaskReviewGate } from "@stigmer/react";
import { BrowserView } from "@scenar/react";
import {
  OUTCOMES,
  REVIEW_PAYLOAD,
  REVIEW_PROMPT,
  TASK_NAME,
  UI_HINT,
} from "../_shared/article-review";
import type { ReviewFallbackTourStep } from "./steps";

/**
 * The same app framing as `review-renderer-tour`, deliberately: the two
 * embeds sit thirty lines apart on one docs page, and identical framing
 * makes the one difference — the presentation of the same payload — the
 * only thing that changes between them.
 */
const APP_URL = "app.acme.com/reviews";

/** A reading-width column for the review card, on the app's background. */
const REVIEW_PAGE: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  background: "var(--stgm-background)",
};
const REVIEW_CONTENT: CSSProperties = {
  margin: "0 auto",
  maxWidth: 720,
  padding: "40px 24px",
};

const noopSubmit = async () => undefined;

/**
 * Pure `renderStep`: the real `WorkflowTaskReviewGate` with the shared
 * payload — and no renderer registered by this tour's providers, so the
 * SDK's built-in approval card presents it. Wrapped `inert` (the
 * connect-tools precedent): the card renders real decision buttons a viewer
 * must not drive mid-playback.
 */
export function renderStep(data: ReviewFallbackTourStep): ReactNode {
  switch (data.view) {
    case "fallback-gate":
      return (
        <BrowserView url={APP_URL} contentKey="fallback">
          <div style={REVIEW_PAGE} inert>
            <div style={REVIEW_CONTENT}>
              <WorkflowTaskReviewGate
                taskName={TASK_NAME}
                prompt={REVIEW_PROMPT}
                outcomes={OUTCOMES}
                payload={REVIEW_PAYLOAD}
                uiHint={UI_HINT}
                onSubmit={noopSubmit}
                isSubmitting={false}
              />
            </div>
          </div>
        </BrowserView>
      );
  }
}
