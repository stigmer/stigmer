/**
 * Chat link tour — a single beat of the real `ChatLinkDialog` in its
 * editor state, scene-setting for `docs/guides/channels/create-a-chat-link.mdx`.
 *
 * The dialog is handed an already-created chat link, so it opens as that
 * link's editor — audience, hosted link, embed snippet, allowed origins, and
 * the who-pays affordance. The guide's numbered steps describe *creating* a
 * chat link (the dialog's name/slug step, reached by omitting the `channel`
 * prop); that create-flow choreography is a follow-up, not this beat.
 *
 * Ported from the `share-agent-dialog` docs inline demo.
 */
import { create } from "@bufbuild/protobuf";
import {
  ChannelSchema,
  type Channel,
} from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The single surface this tour shows (one branch in `renderStep`). */
export type ChatLinkTourStep = { view: "chat-link-dialog" };

/** The agent's slug — the chat link's own slug defaults to it. */
export const DEMO_SLUG = "support-agent";

// ---------------------------------------------------------------------------
// Fixtures (the dialog is fully prop-driven; only billing goes over RPC)
// ---------------------------------------------------------------------------

/** The agent whose chat link the dialog manages (identity props only). */
export function buildDemoAgent() {
  return samples.agent({
    name: DEMO_SLUG,
    org: DEMO_ORG,
    description: "Handles customer support requests.",
  });
}

/**
 * The settled chat link the dialog edits — enabled, one allowed embed
 * origin. A chat link is a web Channel: the dialog edits exactly the channel
 * it is given. A playback never applies, so
 * this is a plain settled state, not the legacy demo's mutable echo.
 */
export function buildDemoChatLink(): Channel {
  return create(ChannelSchema, {
    metadata: {
      id: "chn_demo",
      org: DEMO_ORG,
      slug: DEMO_SLUG,
      name: DEMO_SLUG,
    },
    spec: {
      agentRef: { org: DEMO_ORG, slug: DEMO_SLUG },
      enabled: true,
      type: { case: "web", value: { allowedOrigins: ["https://acme.com"] } },
    },
  });
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const chatLinkTourSteps: ScenarioStep<ChatLinkTourStep>[] = [
  {
    // Floor for muted playback; narration extends the beat when it runs
    // longer. Step 0 is interaction-free by rule, so this beat holds a
    // steady frame of the open dialog.
    delayMs: 6000,
    data: { view: "chat-link-dialog" },
    narration:
      "The chat link's dialog is the whole channel in one place — who can " +
      "chat on the hosted link, the embed snippet for your own site, and " +
      "which organization pays, stated before anything goes live.",
  },
];
