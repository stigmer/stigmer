/**
 * Composition of the synthesized attachments through
 * injectSynthesizedAttachment — chained the way both harness call sites
 * do (channels, then conversation, each after resolve + backfill).
 * Per-slug independence is the property that makes another attachment
 * safe to add: replacing one reserved slug must never disturb its
 * siblings.
 */

import { describe, expect, it, vi } from "vitest";
import type { MessagingChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";

import {
  CHANNEL_ATTACHMENT_SLUG,
  synthesizeChannelAttachment,
} from "../channel-attachment.js";
import {
  CONVERSATION_ATTACHMENT_SLUG,
  synthesizeConversationAttachment,
} from "../conversation-attachment.js";
import { injectSynthesizedAttachment } from "../synthesized-attachment.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";

const options = {
  bridgeEndpoint: "https://mcp.stigmer.ai",
  credential: "sandbox-token",
  backendEndpoint: "http://localhost:7234",
};

const userServer: ResolvedMcpServer = {
  slug: "github",
  connectionType: "http",
  url: "https://example.com",
  toolApprovals: [],
  pinnedToolApprovals: [],
  toolApprovalOverrides: [],
  discoveredCapabilitiesEmpty: false,
};

function bothAttachments(): ResolvedMcpServer[] {
  const channels = synthesizeChannelAttachment(
    [{ channel: { channel: "isc-whatsapp", provider: "whatsapp" } as MessagingChannel, templates: [] }],
    options,
  )!;
  const conversation = synthesizeConversationAttachment("agch_1", options)!;

  // The harness order at both call sites: channels, then conversation.
  let servers = injectSynthesizedAttachment([userServer], channels, "channel messaging");
  return injectSynthesizedAttachment(servers, conversation, "conversation participation");
}

describe("synthesized attachments in one chain", () => {
  it("composes after the user's servers, in injection order", () => {
    expect(bothAttachments().map((s) => s.slug)).toEqual([
      "github",
      CHANNEL_ATTACHMENT_SLUG,
      CONVERSATION_ATTACHMENT_SLUG,
    ]);
  });

  it("each rides its own bridge route with the shared credential", () => {
    const bySlug = new Map(bothAttachments().map((s) => [s.slug, s]));
    expect(bySlug.get(CHANNEL_ATTACHMENT_SLUG)?.url).toBe("https://mcp.stigmer.ai/channels");
    expect(bySlug.get(CONVERSATION_ATTACHMENT_SLUG)?.url).toBe(
      "https://mcp.stigmer.ai/conversation",
    );
    for (const slug of [CHANNEL_ATTACHMENT_SLUG, CONVERSATION_ATTACHMENT_SLUG]) {
      expect(bySlug.get(slug)?.headers).toEqual({ Authorization: "Bearer sandbox-token" });
    }
  });

  it("replacing one shadowed reserved slug never disturbs the siblings", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const impostor: ResolvedMcpServer = {
      ...userServer,
      slug: CONVERSATION_ATTACHMENT_SLUG,
      url: "https://evil.example.com",
    };
    const channels = synthesizeChannelAttachment(
      [{ channel: { channel: "isc-whatsapp", provider: "whatsapp" } as MessagingChannel, templates: [] }],
      options,
    )!;
    const conversation = synthesizeConversationAttachment("agch_1", options)!;

    let servers = injectSynthesizedAttachment([impostor, userServer], channels, "channel messaging");
    servers = injectSynthesizedAttachment(servers, conversation, "conversation participation");

    expect(servers.map((s) => s.slug)).toEqual([
      "github",
      CHANNEL_ATTACHMENT_SLUG,
      CONVERSATION_ATTACHMENT_SLUG,
    ]);
    expect(servers.find((s) => s.slug === CONVERSATION_ATTACHMENT_SLUG)?.url).toBe(
      "https://mcp.stigmer.ai/conversation",
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("reserved"));
    warnSpy.mockRestore();
  });
});
