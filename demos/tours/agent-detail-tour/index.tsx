import type { CSSProperties, ReactNode } from "react";
import { AgentDetailView } from "@stigmer/react";
import { BrowserView } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";
import { DEMO_SLUG, type AgentDetailTourStep } from "./steps";

/** The console's address as the depicted browser shows it. */
const CONSOLE_URL = "app.stigmer.ai";

/**
 * The library zone's page scroll pane and content column, at the console's
 * own geometry (`LibraryLayout`: `mx-auto max-w-4xl px-6 py-8`). No zoom —
 * the shell lays out at real size (one scale factor per frame).
 */
const DETAIL_PAGE: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  background: "var(--stgm-background)",
};
const DETAIL_CONTENT: CSSProperties = {
  margin: "0 auto",
  maxWidth: 896,
  padding: "32px 24px",
};

/**
 * Pure `renderStep`: the tour's single beat is the real `AgentDetailView`
 * inside a browser window at the agent's console route. The player, cursor,
 * narration, and viewport are supplied by `scenar pack` (embed) and
 * `scenar render` (video) — this stays declarative.
 */
export function renderStep(data: AgentDetailTourStep): ReactNode {
  switch (data.view) {
    case "agent-detail":
      return (
        <BrowserView url={`${CONSOLE_URL}/library/agents/${DEMO_SLUG}`} contentKey="detail">
          <div style={DETAIL_PAGE}>
            <div style={DETAIL_CONTENT}>
              <AgentDetailView org={DEMO_ORG} slug={DEMO_SLUG} />
            </div>
          </div>
        </BrowserView>
      );
  }
}
