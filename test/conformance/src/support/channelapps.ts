// Canonical valid ChannelApp fixtures for the conformance suite.
// Domain: conformance support.
//
// A ChannelApp is a customer-owned messaging-platform app (a Slack app or a
// Meta/WhatsApp app) that agent channels install through instead of the
// shared platform app. Its spec is a required provider oneof whose arms
// carry real secrets — encrypted at rest, redacted to the platform marker on
// every read, rotated per field via the marker convention (the OAuthApp
// secret contract generalized to multiple secrets per arm).
//
// Negative cases (missing secrets, ciphertext-shaped values, provider flips)
// are written inline in the suite: this module is validity by construction.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";

export const CHANNELAPP_API_VERSION = "agentic.stigmer.ai/v1";
export const CHANNELAPP_KIND = "ChannelApp";

// The redaction sentinel every read surface substitutes for stored secrets.
// A CROSS-EDITION CONTRACT STRING (the oauthapp/environment marker); sending
// it back on update means "keep the stored value" — independently per field,
// which is what makes single-secret rotation possible.
export const CHANNELAPP_REDACTED_MARKER = "***REDACTED***";

export interface SlackChannelAppOptions {
  clientId?: string;
  clientSecret?: string;
  signingSecret?: string;
}

// A complete, valid Slack ChannelApp ready to hand to create/apply/update.
export function makeSlackChannelApp(
  org: string,
  name: string,
  options: SlackChannelAppOptions = {},
): MessageInitShape<typeof ChannelAppSchema> {
  return {
    apiVersion: CHANNELAPP_API_VERSION,
    kind: CHANNELAPP_KIND,
    metadata: { name, org },
    spec: {
      providerConfig: {
        case: "slack",
        value: {
          clientId: options.clientId ?? "conformance-slack-client-id",
          clientSecret: options.clientSecret ?? "conformance-slack-client-secret",
          signingSecret: options.signingSecret ?? "conformance-slack-signing-secret",
        },
      },
    },
  };
}

// A complete, valid WhatsApp ChannelApp — the second provider arm, used by
// the provider-immutability negatives and the WhatsApp-specific rules.
export function makeWhatsAppChannelApp(
  org: string,
  name: string,
): MessageInitShape<typeof ChannelAppSchema> {
  return {
    apiVersion: CHANNELAPP_API_VERSION,
    kind: CHANNELAPP_KIND,
    metadata: { name, org },
    spec: {
      providerConfig: {
        case: "whatsapp",
        value: {
          appId: "1234567890",
          appSecret: "conformance-wa-app-secret",
          accessToken: "conformance-wa-access-token",
          verifyToken: "conformance-wa-verify-token",
        },
      },
    },
  };
}
