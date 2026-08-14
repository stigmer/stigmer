import type { CSSProperties, ReactNode } from "react";
import { BrowserView } from "@scenar/react";
import { ConversationsWorkbench } from "@stigmer/react";
import { AppShell } from "../_shared/AppShell";
import { DEMO_NOW, DEMO_ORG } from "../_shared/fixtures";
import { WANTS_HUMAN_CONVERSATIONS, CHANNEL_ID, YOU } from "./fixtures";
import type { TakeOverTourStep } from "./steps";

/** The console's address as the depicted browser shows it. */
const CONSOLE_URL = "app.stigmer.ai";

/**
 * The workbench fills the workspace zone edge-to-edge (the console's
 * Conversations page owns no extra framing), so the wrapper only supplies
 * the flex column its `min-h-0` layout expects — at real size, one scale
 * factor per frame.
 */
const CONVERSATIONS_ZONE: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

/**
 * Pure `renderStep`: each beat is the real `ConversationsWorkbench` with a
 * different controlled selection — the beat selector `steps.ts` carries.
 * The workbench subtree is `inert` (the review-renderer-tour pattern): it
 * renders real Take over / Hand back / Send controls a reader's stray
 * click must never drive mid-playback. Selection is fixture-controlled,
 * so the change handler is a no-op by construction.
 */
export function renderStep(data: TakeOverTourStep, stepIndex: number): ReactNode {
  return (
    <BrowserView url={`${CONSOLE_URL}/conversations`} contentKey={String(stepIndex)}>
      <AppShell
        activeNav="conversations"
        conversationsBadgeCount={WANTS_HUMAN_CONVERSATIONS.length}
        contentKey={String(stepIndex)}
        slideDirection={stepIndex === 0 ? undefined : "forward"}
      >
        <div style={CONVERSATIONS_ZONE} inert>
          <ConversationsWorkbench
            org={DEMO_ORG}
            selected={
              data.conversationKey === null
                ? null
                : {
                    agentChannelId: CHANNEL_ID,
                    conversationKey: data.conversationKey,
                  }
            }
            onSelectionChange={() => {}}
            currentIdentityAccountId={YOU}
            now={DEMO_NOW}
          />
        </div>
      </AppShell>
    </BrowserView>
  );
}
