import type { CSSProperties, ReactNode } from "react";
import { ShareAgentDialog } from "@stigmer/react";
import { BrowserView } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";
import { DEMO_SLUG, buildDemoAgent, buildDemoShare, type ShareAgentTourStep } from "./steps";

/** The console's address as the depicted browser shows it. */
const CONSOLE_URL = "app.stigmer.ai";

/**
 * The page behind the dialog: the console background, dialog centered. The
 * dialog renders in-flow (`modal={false}` — its own documented seam for
 * documentation demos), so there is no top layer for the pack mechanism's
 * CSS zoom to lose.
 */
const DIALOG_PAGE: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-start",
  padding: "40px 24px",
  background: "var(--stgm-background)",
};

const noop = () => {};

/**
 * Pure `renderStep`: the tour's single beat is the real `ShareAgentDialog`
 * open on its editor state. Wrapped `inert` (the connect-tools precedent):
 * the dialog renders real toggles, copy buttons, and a save path a viewer
 * must not drive mid-playback — the beat depicts the state, the narration
 * tells the story.
 */
export function renderStep(data: ShareAgentTourStep): ReactNode {
  switch (data.view) {
    case "share-dialog":
      return (
        <BrowserView
          url={`${CONSOLE_URL}/library/agents/${DEMO_SLUG}`}
          contentKey="share"
        >
          <div style={DIALOG_PAGE} inert>
            <ShareAgentDialog
              open
              onOpenChange={noop}
              agent={buildDemoAgent()}
              share={buildDemoShare()}
              buildShareUrl={(org, slug) => `https://app.stigmer.ai/chat/${org}/${slug}`}
              modal={false}
            />
          </div>
        </BrowserView>
      );
  }
}
