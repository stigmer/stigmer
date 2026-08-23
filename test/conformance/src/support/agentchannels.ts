// Canonical valid AgentChannel fixtures for the conformance suite.
// Domain: conformance support.
//
// An AgentChannel binds one agent to one external messaging workspace
// (Slack or WhatsApp). The spec is deliberately small — which agent serves,
// whether serving is enabled, the provider arm, and credential wiring —
// because workspace identity lives in status, produced by the install flow
// (which the OSS edition refuses; see the agentchannel suite header).
//
// The same-org invariant is structural: agent_ref.org and app_ref.org must
// both equal metadata.org (channels have no cross-org arm — the channel's
// org is the billing and credentials org). Builders leave ref orgs empty by
// default so the server's relative-reference normalization is exercised;
// negatives set them explicitly.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export const AGENTCHANNEL_API_VERSION = "agentic.stigmer.ai/v1";
export const AGENTCHANNEL_KIND = "AgentChannel";

// The default model pin every channel fixture carries. Cloud REQUIRES a
// pinned model on channel writes (its channel execution profile serves the
// Cursor harness, where an unpinned run would bill as Auto —
// stigmer/stigmer#362); OSS merely validates a pin that is present. One
// registry-valid pin keeps every fixture accepted by both editions; the
// pin-REQUIRED divergence itself is pinned two-armed in the suite.
export const CHANNEL_FIXTURE_MODEL = "composer-2.5";

export interface SlackAgentChannelOptions {
  // Explicit agent_ref org, for the cross-org negative; empty means
  // same-org (the platform's relative-reference convention).
  agentRefOrg?: string;
  enabled?: boolean;
  // ChannelApp binding (BYO app). Optional for Slack — absent means the
  // shared platform app.
  appRefSlug?: string;
  appRefOrg?: string;
  // Per-channel model pin. Defaults to CHANNEL_FIXTURE_MODEL (see its
  // comment); pass an unknown name for the existence-rule negative (#774)
  // or `null` to omit the pin entirely (the two-armed #362 divergence).
  modelName?: string | null;
}

// A complete, valid Slack AgentChannel for the given agent. Slack's provider
// arm is an empty message by design (`slack: {}` — workspace identity is
// OAuth-observed into status, never declared).
export function makeSlackAgentChannel(
  org: string,
  name: string,
  agentSlug: string,
  options: SlackAgentChannelOptions = {},
): MessageInitShape<typeof AgentChannelSchema> {
  return {
    apiVersion: AGENTCHANNEL_API_VERSION,
    kind: AGENTCHANNEL_KIND,
    metadata: { name, org },
    spec: {
      agentRef: {
        slug: agentSlug,
        kind: ApiResourceKind.agent,
        ...(options.agentRefOrg !== undefined ? { org: options.agentRefOrg } : {}),
      },
      enabled: options.enabled ?? true,
      providerConfig: { case: "slack", value: {} },
      ...(options.appRefSlug !== undefined
        ? {
            appRef: {
              slug: options.appRefSlug,
              kind: ApiResourceKind.channel_app,
              ...(options.appRefOrg !== undefined ? { org: options.appRefOrg } : {}),
            },
          }
        : {}),
      ...(options.modelName !== null
        ? { runConfig: { modelName: options.modelName ?? CHANNEL_FIXTURE_MODEL } }
        : {}),
    },
  };
}

// A complete WhatsApp AgentChannel. WhatsApp is BYO-only (DD-WA-2): app_ref
// is required, which is exactly the arm the suite's negative drops.
export function makeWhatsAppAgentChannel(
  org: string,
  name: string,
  agentSlug: string,
  options: { appRefSlug?: string } = {},
): MessageInitShape<typeof AgentChannelSchema> {
  return {
    apiVersion: AGENTCHANNEL_API_VERSION,
    kind: AGENTCHANNEL_KIND,
    metadata: { name, org },
    spec: {
      agentRef: { slug: agentSlug, kind: ApiResourceKind.agent },
      enabled: true,
      providerConfig: { case: "whatsapp", value: { phoneNumberId: "106540352242922" } },
      runConfig: { modelName: CHANNEL_FIXTURE_MODEL },
      ...(options.appRefSlug !== undefined
        ? { appRef: { slug: options.appRefSlug, kind: ApiResourceKind.channel_app } }
        : {}),
    },
  };
}
