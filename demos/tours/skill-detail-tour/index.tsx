import type { CSSProperties, ReactNode } from "react";
import { SkillDetailView } from "@stigmer/react";
import { BrowserView } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";
import { SKILL_SLUG, type SkillDetailTourStep } from "./steps";

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
 * Pure `renderStep`: the tour's single beat is the real `SkillDetailView`
 * inside a browser window at the skill's console route. The player, cursor,
 * narration, and viewport are supplied by `scenar pack` (embed) and
 * `scenar render` (video) — this stays declarative.
 */
export function renderStep(data: SkillDetailTourStep): ReactNode {
  switch (data.view) {
    case "skill-detail":
      return (
        <BrowserView url={`${CONSOLE_URL}/library/skills/${SKILL_SLUG}`} contentKey="detail">
          <div style={DETAIL_PAGE}>
            <div style={DETAIL_CONTENT}>
              <SkillDetailView org={DEMO_ORG} slug={SKILL_SLUG} />
            </div>
          </div>
        </BrowserView>
      );
  }
}
