/**
 * Connect-WhatsApp channel flow — walkthrough of putting an Agent behind
 * a WhatsApp Business number:
 *
 * Channels tab (empty state) → cursor clicks "Connect to WhatsApp" →
 * connect dialog over the tab (the cursor types the phone number ID into
 * the real input — the connect button is disabled until the number is
 * filled) → cursor clicks the dialog's connect button → Channels tab
 * with the installed channel card → WhatsApp on a phone: a person texts
 * the number and the agent replies.
 *
 * All console steps render the real SDK components (AgentChannelsPanel,
 * ConnectWhatsAppDialog); only the phone-side WhatsApp conversation is
 * scenario-owned JSX. Unlike Slack there is no consent page — the direct
 * install completes in the dialog — so the phone steps carry the payoff
 * the consent page carried for Slack: seeing the channel from the other
 * side. The dialog's in-flight and success states are internal to the
 * component and unreachable from props, so the honest "after" state is
 * the panel's installed card, same as the Slack demo.
 */

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  AgentChannelSpecSchema,
  WhatsAppChannelConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/spec_pb";
import {
  AgentChannelStatusSchema,
  AgentChannelInstallState,
  WhatsAppInstallStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import {
  ChannelAppSpecSchema,
  WhatsAppChannelAppConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/spec_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEMO_ORG = "acme";
export const DEMO_AGENT_SLUG = "support-agent";
export const DEMO_APP_ID = "chapp-00000000-0000-0000-0000-000000000001";
export const DEMO_APP_SLUG = "acme-whatsapp";
export const DEMO_APP_NAME = "Acme WhatsApp";
export const DEMO_PHONE_NUMBER_ID = "106540352242922";
export const DEMO_DISPLAY_NUMBER = "+1 555 025 3483";
export const DEMO_VERIFIED_NAME = "Acme Corp";

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
 * The org's registered Meta app. Present in every step (not just the
 * dialog): the panel resolves the installed card's serving-app NAME by
 * matching `spec.app_ref.slug` against this list — an empty list would
 * render the raw slug. Secrets carry the server's redaction marker,
 * matching what a real list response looks like.
 */
export function buildWhatsAppApp(): ChannelApp {
  return create(ChannelAppSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "ChannelApp",
    metadata: {
      id: DEMO_APP_ID,
      name: DEMO_APP_NAME,
      slug: DEMO_APP_SLUG,
      org: DEMO_ORG,
    },
    spec: create(ChannelAppSpecSchema, {
      providerConfig: {
        case: "whatsapp",
        value: create(WhatsAppChannelAppConfigSchema, {
          appId: "735281906457812",
          appSecret: "***REDACTED***",
          accessToken: "***REDACTED***",
          verifyToken: "***REDACTED***",
        }),
      },
    }),
  });
}

/**
 * The channel as it looks after the direct install completed: installed
 * through the org's own Meta app (WhatsApp is BYO-only), serving switch
 * on, number facts observed by the install probe echoed into status.
 */
export function buildInstalledChannel(): AgentChannel {
  return create(AgentChannelSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "AgentChannel",
    metadata: {
      id: "ach-00000000-0000-0000-0000-000000000002",
      name: `${DEMO_AGENT_SLUG} WhatsApp`,
      slug: `${DEMO_AGENT_SLUG}-whatsapp`,
      org: DEMO_ORG,
    },
    spec: create(AgentChannelSpecSchema, {
      agentRef: { org: DEMO_ORG, slug: DEMO_AGENT_SLUG },
      enabled: true,
      providerConfig: {
        case: "whatsapp",
        value: create(WhatsAppChannelConfigSchema, {
          phoneNumberId: DEMO_PHONE_NUMBER_ID,
        }),
      },
      appRef: { org: DEMO_ORG, slug: DEMO_APP_SLUG },
    }),
    status: create(AgentChannelStatusSchema, {
      installState: AgentChannelInstallState.installed,
      providerStatus: {
        case: "whatsapp",
        value: create(WhatsAppInstallStatusSchema, {
          phoneNumberId: DEMO_PHONE_NUMBER_ID,
          displayPhoneNumber: DEMO_DISPLAY_NUMBER,
          verifiedName: DEMO_VERIFIED_NAME,
          channelAppId: DEMO_APP_ID,
          installedAt: timestampFromDate(new Date()),
        }),
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Step data model
// ---------------------------------------------------------------------------

export type ConnectWhatsAppStep =
  | { view: "channels-empty" }
  | { view: "click-connect" }
  | { view: "connect-dialog" }
  | { view: "click-dialog-connect" }
  | { view: "channels-connected" }
  | { view: "whatsapp-message" }
  | { view: "whatsapp-reply" };

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const connectWhatsAppSteps: ScenarioStep<ConnectWhatsAppStep>[] = [
  {
    delayMs: 0,
    data: { view: "channels-empty" },
    narration:
      "Channels put an agent where people already are. WhatsApp connects a business phone number — this agent has none yet, so its Channels tab offers to connect one.",
  },
  {
    delayMs: 3500,
    data: { view: "click-connect" },
  },
  {
    delayMs: 2500,
    data: { view: "connect-dialog" },
    narration:
      "The dialog asks for the phone number I D from your Meta app, and which registered app serves it. With a single app registered, it is already selected.",
    // The connect button is disabled until the number is filled, so the
    // cursor walks to the field and types the ID during the narration.
    interactions: [
      { atPercent: 0.3, type: "set_cursor", target: "dialog-whatsapp-number" },
      {
        atPercent: 0.45,
        type: "type",
        target: "dialog-whatsapp-number",
        text: DEMO_PHONE_NUMBER_ID,
      },
    ],
  },
  {
    delayMs: 5200,
    data: { view: "click-dialog-connect" },
  },
  {
    delayMs: 2500,
    data: { view: "channels-connected" },
    narration:
      "Stigmer verifies the number with WhatsApp through your app's credentials — no browser hand-off. The card shows the verified number, the business name, and the serving app.",
  },
  {
    delayMs: 4500,
    data: { view: "whatsapp-message" },
  },
  {
    delayMs: 3000,
    data: { view: "whatsapp-reply" },
    narration:
      "People simply message the number. The answers come from your agent, with your organization's policies, rate limits, and billing enforced by Stigmer.",
  },
];
