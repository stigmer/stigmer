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
import type { ReviewRendererTourStep } from "./steps";

/**
 * The depicted surface is the *integrator's* app, not the Stigmer console —
 * registering a renderer is something an embedding product does. Acme (the
 * tour world's org) reviews its editorial workflow in its own app.
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
 * Pure `renderStep`: the real `WorkflowTaskReviewGate`, presenting the shared
 * payload through the renderer this tour's providers registered. Wrapped
 * `inert` (the connect-tools precedent): the gate renders real
 * Approve/Request-changes buttons a viewer must not drive mid-playback.
 */
export function renderStep(data: ReviewRendererTourStep): ReactNode {
  switch (data.view) {
    case "renderer-gate":
      return (
        <BrowserView url={APP_URL} contentKey="renderer">
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
