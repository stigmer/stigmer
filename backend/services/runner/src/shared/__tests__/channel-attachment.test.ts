/**
 * The channel messaging attachment (proactive-messaging DD-006 D7/D8):
 * discovery with the never-throw failure posture, both connection
 * shapes, the structural approval-freedom of synthesized attachments,
 * and the prompt section's filter/order/cap rules
 * (DD-006 D6). The route is the cross-repo string, guarded here and in
 * the mcp-server integration test (the TOOL_CALL_LIMIT precedent); the
 * slug and roster are runner-internal and guarded here alone.
 */

import { describe, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import type {
  ChannelTemplate,
  MessagingChannel,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";

import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { mergeApprovalPolicies, type ActiveLeases } from "../approval-policy.js";
import { needsBackfill } from "../connect-backfill.js";
import {
  CHANNEL_ATTACHMENT_SLUG,
  CHANNELS_ROUTE,
  TEMPLATE_SECTION_CAP,
  discoverChannelMessaging,
  formatChannelTemplatesSection,
  synthesizeChannelAttachment,
  type ChannelMessagingInfo,
} from "../channel-attachment.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";

function channel(slug: string): MessagingChannel {
  return { channel: slug, provider: "whatsapp" } as MessagingChannel;
}

function template(overrides: Partial<ChannelTemplate>): ChannelTemplate {
  return {
    name: "fee_reminder",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    parameterFormat: "POSITIONAL",
    parameterNames: ["1", "2"],
    bodyText: "Hi {{1}}, your fee of {{2}} is due.",
    headerFormat: "",
    rejectionReason: "",
    unsupportedReason: "",
    ...overrides,
  } as ChannelTemplate;
}

function info(slug: string, templates: ChannelTemplate[]): ChannelMessagingInfo {
  return { channel: channel(slug), templates };
}

const noLeases: ActiveLeases = {
  global: false,
  categories: new Set(),
  servers: new Set(),
};

describe("discoverChannelMessaging (the DD-006 D4 failure posture)", () => {
  it("returns channels with their templates, threading the scoped credential", async () => {
    const client = mockStigmerClient({
      listMessagingChannels: vi.fn().mockResolvedValue([channel("isc-whatsapp")]),
      listChannelTemplates: vi.fn().mockResolvedValue([template({})]),
    });

    const result = await discoverChannelMessaging(client, "scoped-tok");

    expect(result).toHaveLength(1);
    expect(result[0].channel.channel).toBe("isc-whatsapp");
    expect(result[0].templates).toHaveLength(1);
    expect(client.listMessagingChannels).toHaveBeenCalledWith("scoped-tok");
    expect(client.listChannelTemplates).toHaveBeenCalledWith("isc-whatsapp", "scoped-tok");
  });

  it("answers empty for the everyday no-channel agent without fetching templates", async () => {
    const client = mockStigmerClient();

    expect(await discoverChannelMessaging(client, undefined)).toEqual([]);
    expect(client.listChannelTemplates).not.toHaveBeenCalled();
  });

  it.each([
    ["UNIMPLEMENTED (a control plane predating 3a)", Code.Unimplemented],
    ["FAILED_PRECONDITION (the OSS posture on older servers)", Code.FailedPrecondition],
    ["PERMISSION_DENIED (an unexpected reach refusal)", Code.PermissionDenied],
  ])("degrades %s to honest absence, never a throw", async (_label, code) => {
    const client = mockStigmerClient({
      listMessagingChannels: vi.fn().mockRejectedValue(new ConnectError("nope", code)),
    });
    const quiet = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await discoverChannelMessaging(client, undefined)).toEqual([]);

    quiet.mockRestore();
    warn.mockRestore();
  });

  it("a template-read failure degrades PER CHANNEL — the tool survives, the section entry does not", async () => {
    const client = mockStigmerClient({
      listMessagingChannels: vi.fn().mockResolvedValue([channel("wa-a"), channel("wa-b")]),
      listChannelTemplates: vi.fn()
        .mockImplementation(async (slug: string) => {
          if (slug === "wa-a") throw new ConnectError("registry down", Code.Unavailable);
          return [template({})];
        }),
    });
    const quiet = vi.spyOn(console, "debug").mockImplementation(() => {});

    const result = await discoverChannelMessaging(client, undefined);

    expect(result.map((r) => [r.channel.channel, r.templates.length])).toEqual([
      ["wa-a", 0],
      ["wa-b", 1],
    ]);
    quiet.mockRestore();
  });
});

describe("synthesizeChannelAttachment", () => {
  const options = {
    bridgeEndpoint: "https://mcp.stigmer.ai/",
    credential: "sandbox-token",
    backendEndpoint: "http://localhost:7234",
  };

  it("returns undefined when the agent serves no proactive channel", () => {
    expect(synthesizeChannelAttachment([], options)).toBeUndefined();
  });

  it("builds the HTTP shape against the bridge /channels route with the credential", () => {
    const attachment = synthesizeChannelAttachment([info("isc-whatsapp", [])], options);
    expect(attachment).toMatchObject({
      slug: CHANNEL_ATTACHMENT_SLUG,
      connectionType: "http",
      url: "https://mcp.stigmer.ai/channels",
      headers: { Authorization: "Bearer sandbox-token" },
    });
  });

  it("builds the OSS stdio shape: the CLI-embedded bridge with the channels roster", () => {
    const attachment = synthesizeChannelAttachment([info("isc-whatsapp", [])], {
      bridgeEndpoint: null,
      credential: null,
      backendEndpoint: "http://localhost:7234",
    });
    expect(attachment).toMatchObject({
      connectionType: "stdio",
      command: "stigmer",
      args: ["mcp-server"],
      env: {
        STIGMER_MCP_ROSTER: "channels",
        STIGMER_SERVER_ADDRESS: "localhost:7234",
      },
    });
  });

  it("pins the cross-repo strings the mcp-server side guards too", () => {
    expect(CHANNEL_ATTACHMENT_SLUG).toBe("stigmer-channels");
    expect(CHANNELS_ROUTE).toBe("/channels");
  });

  it("is approval-free by construction: zero entries in the merged approval map", () => {
    const attachment = synthesizeChannelAttachment([info("isc-whatsapp", [])], options)!;
    // Forced, not convenient (DD-002 D6): both calling surfaces run
    // UNATTENDED mode, where a gated tool resolves as skip-and-adapt —
    // a gated send tool means reminders never send.
    const merged = mergeApprovalPolicies(
      [attachment as ResolvedMcpServer], noLeases,
    );
    expect(merged.size).toBe(0);
  });

  it("is structurally immune to the connect backfill (destructiveHint tightener)", () => {
    const attachment = synthesizeChannelAttachment([info("isc-whatsapp", [])], options)!;
    expect(attachment.discoveredCapabilitiesEmpty).toBe(false);
    expect(needsBackfill(attachment)).toBe(false);
  });
});

describe("formatChannelTemplatesSection (DD-006 D6)", () => {
  it("renders sendable templates with body text, parameters, and the image-header requirement", () => {
    const section = formatChannelTemplatesSection([
      info("isc-whatsapp", [
        template({}),
        template({
          name: "invoice_qr",
          parameterFormat: "NAMED",
          parameterNames: ["member_name", "amount"],
          bodyText: "Hello {{member_name}}, pay {{amount}}.",
          headerFormat: "IMAGE",
        }),
      ]),
    ]);

    expect(section).toContain("<available_channel_templates>");
    expect(section).toContain("channel: isc-whatsapp (whatsapp)");
    expect(section).toContain("- fee_reminder (en) [UTILITY], parameters: 1, 2");
    expect(section).toContain('"Hi {{1}}, your fee of {{2}} is due."');
    expect(section).toContain(
      "- invoice_qr (en) [UTILITY], parameters: member_name, amount"
        + " (requires header_image_link: a public HTTPS image URL)",
    );
    expect(section).toContain("send_channel_message");
    expect(section).toContain("</available_channel_templates>");
  });

  it("filters unsendable templates out entirely — the console is the diagnosis surface", () => {
    const section = formatChannelTemplatesSection([
      info("isc-whatsapp", [
        template({}),
        template({
          name: "dynamic_promo",
          unsupportedReason: "this template has a dynamic-URL button, which this platform"
            + " version cannot supply parameters for",
        }),
      ]),
    ]);

    expect(section).toContain("fee_reminder");
    expect(section).not.toContain("dynamic_promo");
  });

  it("returns \"\" when nothing is sendable — the tool alone still serves text sends", () => {
    expect(formatChannelTemplatesSection([info("isc-whatsapp", [])])).toBe("");
    expect(formatChannelTemplatesSection([
      info("isc-whatsapp", [template({ unsupportedReason: "unsupported" })]),
    ])).toBe("");
  });

  it("orders deterministically by (name, language) — never registry order", () => {
    const section = formatChannelTemplatesSection([
      info("isc-whatsapp", [
        template({ name: "b_second", language: "en" }),
        template({ name: "a_first", language: "hi" }),
        template({ name: "a_first", language: "en" }),
      ]),
    ]);

    const first = section.indexOf("a_first (en)");
    const second = section.indexOf("a_first (hi)");
    const third = section.indexOf("b_second (en)");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("caps the section and names how many were withheld", () => {
    const many = Array.from({ length: TEMPLATE_SECTION_CAP + 5 }, (_, i) =>
      template({ name: `t_${String(i).padStart(3, "0")}` }));

    const section = formatChannelTemplatesSection([info("isc-whatsapp", many)]);

    expect(section).toContain(`t_${String(TEMPLATE_SECTION_CAP - 1).padStart(3, "0")}`);
    expect(section).not.toContain(`t_${String(TEMPLATE_SECTION_CAP).padStart(3, "0")}`);
    expect(section).toContain("(5 more approved templates not shown)");
  });

  it("the cap spans channels; a later channel with no budget left is omitted whole", () => {
    const fill = Array.from({ length: TEMPLATE_SECTION_CAP }, (_, i) =>
      template({ name: `t_${String(i).padStart(3, "0")}` }));

    const section = formatChannelTemplatesSection([
      info("wa-a", fill),
      info("wa-b", [template({ name: "starved" })]),
    ]);

    expect(section).toContain("channel: wa-a (whatsapp)");
    expect(section).not.toContain("channel: wa-b (whatsapp)");
    expect(section).not.toContain("starved");
    expect(section).toContain("(1 more approved template not shown)");
  });
});
