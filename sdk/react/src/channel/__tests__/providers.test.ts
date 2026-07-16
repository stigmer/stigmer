import { describe, it, expect } from "vitest";
import { CHANNEL_PROVIDERS, channelProviderOf } from "../providers";
import {
  channelPresentationOf,
  DEFAULT_CHANNEL_PRESENTATION,
} from "../providerPresentation";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";

function makeChannel(overrides: {
  installState?: number;
  providerStatus?: unknown;
}): AgentChannel {
  return {
    metadata: { id: "ach_1", org: "acme", slug: "c", name: "C" },
    spec: {},
    status: {
      installState:
        overrides.installState ?? AgentChannelInstallState.installed,
      providerStatus: overrides.providerStatus ?? { case: undefined },
    },
  } as never;
}

describe("channel provider registry", () => {
  it("registers slack and whatsapp with their install styles", () => {
    expect(CHANNEL_PROVIDERS.map((p) => p.id)).toEqual(["slack", "whatsapp"]);
    // The style is what routes a connect click: redirect pre-opens a
    // popup, direct never does (DD-WA-1b keeps the server's `completed`
    // field authoritative for the outcome).
    expect(channelProviderOf("slack")?.installStyle).toBe("redirect");
    expect(channelProviderOf("whatsapp")?.installStyle).toBe("direct");
  });

  it("resolves descriptors by oneof case and answers null for unknown cases", () => {
    expect(channelProviderOf("whatsapp")?.label).toBe("WhatsApp");
    // A newer server's provider must not render half-known.
    expect(channelProviderOf("telegram")).toBeNull();
    expect(channelProviderOf(undefined)).toBeNull();
  });
});

describe("channel provider presentation", () => {
  it("resolves per provider, with the registry's first entry as the default", () => {
    expect(channelPresentationOf("slack")?.id).toBe("slack");
    expect(channelPresentationOf("whatsapp")?.id).toBe("whatsapp");
    expect(channelPresentationOf("telegram")).toBeNull();
    expect(DEFAULT_CHANNEL_PRESENTATION.id).toBe(CHANNEL_PROVIDERS[0].id);
  });

  it("describes an installed WhatsApp channel by its number facts", () => {
    const text = channelPresentationOf("whatsapp")!.describeChannel(
      makeChannel({
        providerStatus: {
          case: "whatsapp",
          value: {
            phoneNumberId: "106540352242922",
            displayPhoneNumber: "+1 555 025 3483",
            verifiedName: "Acme Corp",
          },
        },
      }),
    );

    expect(text).toContain("+1 555 025 3483");
    expect(text).toContain("Acme Corp");
  });

  it("falls back to the phone number ID when no display number was observed", () => {
    const text = channelPresentationOf("whatsapp")!.describeChannel(
      makeChannel({
        providerStatus: {
          case: "whatsapp",
          value: { phoneNumberId: "106540352242922" },
        },
      }),
    );

    expect(text).toContain("106540352242922");
  });

  it("describes a pending WhatsApp channel without Slack vocabulary", () => {
    const text = channelPresentationOf("whatsapp")!.describeChannel(
      makeChannel({ installState: AgentChannelInstallState.pending_install }),
    );

    expect(text).toContain("WhatsApp");
    expect(text).not.toContain("Slack");
  });

  it("keeps Slack's workspace copy intact", () => {
    const presentation = channelPresentationOf("slack")!;
    const text = presentation.describeChannel(
      makeChannel({
        providerStatus: { case: "slack", value: { teamName: "Acme HQ" } },
      }),
    );
    expect(text).toContain("Acme HQ");

    expect(presentation.servingLine(null)).toContain("@mention Stigmer");
    expect(presentation.servingLine("Acme Bot")).toContain("Acme Bot");
  });

  it("scopes disconnect copy per provider — WhatsApp holds no per-install credentials", () => {
    // Slack's install stores a bot token that teardown removes; WhatsApp
    // credentials live on the shared ChannelApp (DD-WA-3) and outlive the
    // channel, so its prompt must not claim credentials are removed.
    expect(
      channelPresentationOf("slack")!.disconnectDescription("C"),
    ).toContain("credentials");
    expect(
      channelPresentationOf("whatsapp")!.disconnectDescription("C"),
    ).not.toContain("credentials");
    expect(
      channelPresentationOf("whatsapp")!.disconnectDescription("C"),
    ).toContain("number binding");
  });
});
