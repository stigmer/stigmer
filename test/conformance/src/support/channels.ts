// Canonical valid Channel fixtures for the conformance suite.
// Domain: conformance support.
//
// A Channel is one way people reach an agent, typed by spec's oneof: a web
// channel (the hosted /chat/<channel id> link, its audience, and an optional
// rotatable link token the server keeps in status), or a Slack or WhatsApp
// channel (a connection whose workspace identity lives in status, produced
// by the install flow, which the open-source edition refuses; see the
// channel suite header). Every type shares the agent reference, the serving
// switch, the vaults and the run settings.
//
// A channel created with neither a name nor a slug takes the slug
// `<agent slug>-<type>`, so every builder makes the name optional: the web
// builder leaves it off unless told otherwise (the nameless channel is the
// one a person makes from the agent's page), the Slack and WhatsApp
// builders take it positionally, `undefined` for the nameless form.
//
// The same-org invariant is structural: agent_ref.org and app_ref.org must
// both equal metadata.org (the channel's org is the billing and credentials
// org). Builders leave ref orgs empty by default so the server's
// relative-reference normalization is exercised; negatives set them
// explicitly.
//
// The web builder writes a public audience unless told otherwise: an
// omitted audience means the organization's members, and most web fixtures
// exercise the anyone-with-the-link lanes (guest mint, vaults, run
// options), which need public said out loud.
import type { InitShape } from "./init-shape";
import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelAudience } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export const CHANNEL_API_VERSION = "agentic.stigmer.ai/v1";
export const CHANNEL_KIND = "Channel";

// The default model pin every Slack and WhatsApp fixture carries: a
// registry-valid pin both editions accept at write (a pin is validated
// against every engine's catalog, since a channel names no engine). Whether
// an unpinned channel is stored is pinned in the suite itself.
export const CHANNEL_FIXTURE_MODEL = "composer-2.5";

// The fields every type shares.
interface CommonChannelOptions {
  // Explicit agent_ref org, for the cross-org negatives; empty means
  // same-org (the platform's relative-reference convention).
  agentRefOrg?: string;
  // The agent version the channel's conversations pin (agent_ref.version):
  // a tag or a content hash; empty is the agent's current version.
  agentRefVersion?: string;
  enabled?: boolean;
}

// The agent reference every builder writes: by slug, of kind agent, with
// the org and version only when the caller gives them.
function agentRefInit(agentSlug: string, options: CommonChannelOptions) {
  return {
    slug: agentSlug,
    kind: ApiResourceKind.agent,
    ...(options.agentRefOrg !== undefined ? { org: options.agentRefOrg } : {}),
    ...(options.agentRefVersion !== undefined ? { version: options.agentRefVersion } : {}),
  };
}

// The metadata every builder writes: the org, and the name only when given.
function metadataInit(org: string, name: string | undefined) {
  return { org, ...(name !== undefined ? { name } : {}) };
}

export interface WebChannelOptions extends CommonChannelOptions {
  // Omit for the nameless channel (slug `<agent slug>-web`, name
  // `<agent name> (Web)`); set for a deliberately distinct link.
  name?: string;
  // Omitted here means PUBLIC, written out. Set org for the member-gated
  // audience, or unspecified to leave the field off the wire, which the
  // server stores as org.
  audience?: ChannelAudience;
  // Vault slugs a guest's runs use (spec.vaults); public audience only.
  vaults?: string[];
}

// A complete, valid web channel for the given agent.
export function makeWebChannel(
  org: string,
  agentSlug: string,
  options: WebChannelOptions = {},
): InitShape<typeof ChannelSchema> {
  return {
    apiVersion: CHANNEL_API_VERSION,
    kind: CHANNEL_KIND,
    metadata: metadataInit(org, options.name),
    spec: {
      agentRef: agentRefInit(agentSlug, options),
      enabled: options.enabled ?? true,
      ...(options.vaults !== undefined
        ? { vaults: options.vaults.map((slug) => ({ slug, kind: ApiResourceKind.vault })) }
        : {}),
      type: {
        case: "web",
        value:
          options.audience === ChannelAudience.unspecified
            ? {}
            : { audience: options.audience ?? ChannelAudience.public },
      },
    },
  };
}

export interface SlackChannelOptions extends CommonChannelOptions {
  // ChannelApp binding (BYO app). Optional for Slack: absent means the
  // shared platform app.
  appRefSlug?: string;
  appRefOrg?: string;
  // Per-channel model pin. Defaults to CHANNEL_FIXTURE_MODEL (see its
  // comment); pass an unknown name for the existence-rule negative (#774)
  // or `null` to omit the pin entirely (the two-armed #362 divergence).
  modelName?: string | null;
}

// A complete, valid Slack channel for the given agent; `name` undefined
// makes the nameless channel (slug `<agent slug>-slack`). Slack's settings
// carry nothing but the optional app binding (`slack: {}`): workspace
// identity is OAuth-observed into status, never declared.
export function makeSlackChannel(
  org: string,
  name: string | undefined,
  agentSlug: string,
  options: SlackChannelOptions = {},
): InitShape<typeof ChannelSchema> {
  return {
    apiVersion: CHANNEL_API_VERSION,
    kind: CHANNEL_KIND,
    metadata: metadataInit(org, name),
    spec: {
      agentRef: agentRefInit(agentSlug, options),
      enabled: options.enabled ?? true,
      ...(options.modelName !== null
        ? { runConfig: { modelName: options.modelName ?? CHANNEL_FIXTURE_MODEL } }
        : {}),
      type: {
        case: "slack",
        value:
          options.appRefSlug !== undefined
            ? {
                appRef: {
                  slug: options.appRefSlug,
                  kind: ApiResourceKind.channel_app,
                  ...(options.appRefOrg !== undefined ? { org: options.appRefOrg } : {}),
                },
              }
            : {},
      },
    },
  };
}

// The phone number id every WhatsApp fixture serves: Meta's documented
// sample id, never a live number (the open-source edition installs nothing).
export const WHATSAPP_FIXTURE_PHONE_NUMBER_ID = "106540352242922";

// A complete WhatsApp channel; `name` undefined makes the nameless channel
// (slug `<agent slug>-whatsapp`). WhatsApp is BYO-only: app_ref is
// required, which is exactly the field the suite's negative leaves off.
export function makeWhatsAppChannel(
  org: string,
  name: string | undefined,
  agentSlug: string,
  options: CommonChannelOptions & { appRefSlug?: string } = {},
): InitShape<typeof ChannelSchema> {
  return {
    apiVersion: CHANNEL_API_VERSION,
    kind: CHANNEL_KIND,
    metadata: metadataInit(org, name),
    spec: {
      agentRef: agentRefInit(agentSlug, options),
      enabled: options.enabled ?? true,
      runConfig: { modelName: CHANNEL_FIXTURE_MODEL },
      type: {
        case: "whatsapp",
        value: {
          phoneNumberId: WHATSAPP_FIXTURE_PHONE_NUMBER_ID,
          ...(options.appRefSlug !== undefined
            ? { appRef: { slug: options.appRefSlug, kind: ApiResourceKind.channel_app } }
            : {}),
        },
      },
    },
  };
}
