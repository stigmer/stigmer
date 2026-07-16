/**
 * Connect-Slack channel flow — walkthrough of putting an Agent into a
 * Slack workspace:
 *
 * Channels tab (empty state) → cursor clicks "Connect to Slack" →
 * connect dialog over the tab → cursor clicks the dialog's connect
 * button → Slack's consent page (workspace picker + Allow) → Channels
 * tab with the installed channel card.
 *
 * All console steps render the real SDK components (AgentChannelsPanel,
 * ConnectSlackDialog); only Slack's own consent page is scenario-owned
 * JSX. The dialog's in-flight and success states are internal to the
 * component and unreachable from props, so the honest "after" state is
 * the panel's installed card — which is where a real user lands anyway.
 */

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelSpecSchema, SlackChannelConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/spec_pb";
import {
  AgentChannelStatusSchema,
  AgentChannelInstallState,
  SlackInstallStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEMO_ORG = "acme";
export const DEMO_AGENT_SLUG = "support-agent";
export const DEMO_WORKSPACE = "Acme Corp";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function buildDemoAgent() {
  return samples.agent({
    name: DEMO_AGENT_SLUG,
    org: DEMO_ORG,
    description: "Handles customer support requests using company knowledge.",
  });
}

/**
 * The channel as it looks after the install completed: `installed`
 * through the platform Stigmer app (empty channel_app_id), serving
 * switch on, workspace facts observed by the OAuth flow.
 */
export function buildInstalledChannel(): AgentChannel {
  return create(AgentChannelSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "AgentChannel",
    metadata: {
      id: "ach-00000000-0000-0000-0000-000000000001",
      name: `${DEMO_AGENT_SLUG} Slack`,
      slug: `${DEMO_AGENT_SLUG}-slack`,
      org: DEMO_ORG,
    },
    spec: create(AgentChannelSpecSchema, {
      agentRef: { org: DEMO_ORG, slug: DEMO_AGENT_SLUG },
      enabled: true,
      providerConfig: {
        case: "slack",
        value: create(SlackChannelConfigSchema, {}),
      },
    }),
    status: create(AgentChannelStatusSchema, {
      installState: AgentChannelInstallState.installed,
      providerStatus: {
        case: "slack",
        value: create(SlackInstallStatusSchema, {
          teamId: "T0123ABCD",
          teamName: DEMO_WORKSPACE,
          botUserId: "U0456EFGH",
          grantedScopes: [
            "app_mentions:read",
            "assistant:write",
            "chat:write",
            "im:history",
          ],
          installedAt: timestampFromDate(new Date()),
        }),
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Step data model
// ---------------------------------------------------------------------------

export type ConnectSlackStep =
  | { view: "channels-empty" }
  | { view: "click-connect" }
  | { view: "connect-dialog" }
  | { view: "click-dialog-connect" }
  | { view: "slack-consent" }
  | { view: "channels-connected" };

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const connectSlackSteps: ScenarioStep<ConnectSlackStep>[] = [
  {
    delayMs: 0,
    data: { view: "channels-empty" },
    caption: "Every Agent has a Channels tab — this one has no channels yet",
    narration:
      "Channels put an agent where your team already works. This agent has none yet, so its Channels tab offers to connect Slack.",
  },
  {
    delayMs: 3500,
    data: { view: "click-connect" },
    caption: "Click \"Connect to Slack\"",
  },
  {
    delayMs: 2500,
    data: { view: "connect-dialog" },
    caption: "Name the connection — the platform Stigmer app needs no setup",
    narration:
      "The dialog names the connection and shows which Slack app will serve it. The platform Stigmer app works with no setup — or register your own app so the bot carries your name.",
  },
  {
    delayMs: 4200,
    data: { view: "click-dialog-connect" },
    caption: "Click \"Connect to Slack\" to open Slack's consent page",
  },
  {
    delayMs: 2500,
    data: { view: "slack-consent" },
    caption: "Check the workspace picker in the top-right, then Allow",
    narration:
      "Slack asks which workspace to add the bot to. Check the picker in the top right corner — it defaults to the workspace your browser is signed into. Then review the permissions and allow.",
    interactions: [
      { atPercent: 0.3, type: "set_cursor", target: "workspace-picker" },
      { atPercent: 0.75, type: "set_cursor", target: "allow-btn" },
    ],
  },
  {
    delayMs: 4500,
    data: { view: "channels-connected" },
    caption: "Connected — the card shows the workspace and the serving app",
    narration:
      "The channel is live. Members reach it by messaging Stigmer in Slack, and the answers come from your agent. The card's switch pauses serving at any time.",
  },
];
