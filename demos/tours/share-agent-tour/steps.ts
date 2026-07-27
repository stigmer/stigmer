/**
 * Share Agent tour — a single beat of the real `ShareAgentDialog` in its
 * editor state, scene-setting for `docs/guides/sharing/share-an-agent.mdx`.
 *
 * The dialog is handed an already-created share, so it opens as that share's
 * editor — audience, hosted link, embed snippet, allowed origins, and the
 * who-pays affordance. The guide's numbered steps describe *creating* a share
 * (the dialog's name/slug step, reached by omitting the `share` prop); that
 * create-flow choreography is a recorded follow-up, not this beat (see the
 * migration project's debt notes in scenar-cloud).
 *
 * Ported from the `share-agent-dialog` docs inline demo.
 */
import { create } from "@bufbuild/protobuf";
import {
  AgentShareSchema,
  type AgentShare,
} from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The single surface this tour shows (one branch in `renderStep`). */
export type ShareAgentTourStep = { view: "share-dialog" };

/** The shared agent's slug — the share's own slug defaults to it. */
export const DEMO_SLUG = "support-agent";

// ---------------------------------------------------------------------------
// Fixtures (the dialog is fully prop-driven; only billing goes over RPC)
// ---------------------------------------------------------------------------

/** The agent whose sharing the dialog manages (identity props only). */
export function buildDemoAgent() {
  return samples.agent({
    name: DEMO_SLUG,
    org: DEMO_ORG,
    description: "Handles customer support requests.",
  });
}

/**
 * The settled share the dialog edits — enabled, one allowed embed origin.
 * Sharing lives in its own AgentShare resource (console decision 011): the
 * dialog edits exactly the share it is given. A playback never applies, so
 * this is a plain settled state, not the legacy demo's mutable echo.
 */
export function buildDemoShare(): AgentShare {
  return create(AgentShareSchema, {
    metadata: {
      id: "ash_demo",
      org: DEMO_ORG,
      slug: DEMO_SLUG,
      name: DEMO_SLUG,
    },
    spec: {
      agentRef: { org: DEMO_ORG, slug: DEMO_SLUG },
      enabled: true,
      allowedOrigins: ["https://acme.com"],
    },
  });
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const shareAgentTourSteps: ScenarioStep<ShareAgentTourStep>[] = [
  {
    // Floor for muted playback; narration extends the beat when it runs
    // longer. Step 0 is interaction-free by rule, so this beat holds a
    // steady frame of the open dialog.
    delayMs: 6000,
    data: { view: "share-dialog" },
    narration:
      "The Share dialog is the whole channel in one place — who can use the " +
      "hosted link, the embed snippet for your own site, and which " +
      "organization pays, stated before anything goes live.",
  },
];
