/**
 * The conversation participation attachment: the label-keyed attachment
 * decision (the channel id AND the conversation key), the HTTP-only
 * shape (the deliberate no-stdio divergence from both siblings), the
 * structural approval-freedom, and the pinned strings. The route is the
 * cross-repo string — pinned here and in the mcp-server's conversation
 * integration test (the TOOL_CALL_LIMIT precedent); the label is pinned
 * here and on the cloud's side (the sender-identity mirror-guard
 * precedent).
 */

import { describe, expect, it } from "vitest";

import { buildMcpApprovalDefault, type ActiveLeases } from "../approval-policy.js";
import { listTurnTools } from "../mcp-tool-listing.js";
import {
  CHANNEL_ID_LABEL,
  CONVERSATION_ATTACHMENT_SLUG,
  CONVERSATION_KEY_LABEL,
  CONVERSATION_ROUTE,
  readChannelConversationId,
  synthesizeConversationAttachment,
} from "../conversation-attachment.js";

const noLeases: ActiveLeases = {
  global: false,
  categories: new Set(),
  servers: new Set(),
  hooks: new Set(),
};

const cloudOptions = {
  bridgeEndpoint: "https://mcp.stigmer.ai",
  credential: "sandbox-token",
  backendEndpoint: "http://localhost:7234",
};

describe("cross-repo and cross-file pinned strings", () => {
  it("pins the labels verbatim to the cloud's channel runtime constants (mirror guard)", () => {
    // Pinned to the cloud's channel runtime constants, which stamp both
    // labels on every channel-created session. Drift
    // degrades to honest absence — the escalation tool silently stops
    // attaching — never worse; change BOTH sides together.
    expect(CHANNEL_ID_LABEL).toBe("stigmer.ai/channel-id");
    expect(CONVERSATION_KEY_LABEL).toBe("stigmer.ai/channel-conversation-key");
  });

  it("pins the attachment slug and the bridge route", () => {
    // The slug is runner-internal (the resolved-server name and shadow
    // key). The route is cross-repo: the mcp-server's conversation
    // integration test pins CONVERSATION_ROUTE independently — a drift
    // strands every synthesized attachment on a 404.
    expect(CONVERSATION_ATTACHMENT_SLUG).toBe("stigmer-conversation");
    expect(CONVERSATION_ROUTE).toBe("/conversation");
  });
});

describe("readChannelConversationId", () => {
  it("gives a session carrying a channel id and no conversation key no escalation tool", () => {
    // A chat-link (web channel) session carries the channel id but no
    // provider conversation: escalation acts on exactly one provider
    // conversation, so the channel id alone must not attach the tool.
    const labels = { [CHANNEL_ID_LABEL]: "chn_1" };
    expect(readChannelConversationId(labels)).toBeUndefined();
    expect(synthesizeConversationAttachment(readChannelConversationId(labels), cloudOptions)).toBeUndefined();
  });


  it("reads the serving channel id of a session that is a provider conversation", () => {
    expect(
      readChannelConversationId({ [CHANNEL_ID_LABEL]: "chn_1", [CONVERSATION_KEY_LABEL]: "919000000001" }),
    ).toBe("chn_1");
  });

  it("treats missing labels, a missing key, and blank values as absent", () => {
    expect(readChannelConversationId(undefined)).toBeUndefined();
    expect(readChannelConversationId({})).toBeUndefined();
    expect(readChannelConversationId({ [CHANNEL_ID_LABEL]: "", [CONVERSATION_KEY_LABEL]: "919000000001" })).toBeUndefined();
    expect(readChannelConversationId({ [CHANNEL_ID_LABEL]: "   ", [CONVERSATION_KEY_LABEL]: "919000000001" })).toBeUndefined();
    expect(readChannelConversationId({ [CHANNEL_ID_LABEL]: "chn_1", [CONVERSATION_KEY_LABEL]: "   " })).toBeUndefined();
  });

  it("reads a conversation key without a channel id as absent", () => {
    expect(
      readChannelConversationId({ [CONVERSATION_KEY_LABEL]: "919000000001" }),
    ).toBeUndefined();
  });
});

describe("synthesizeConversationAttachment", () => {
  it("returns undefined when the session serves no channel conversation", () => {
    expect(synthesizeConversationAttachment(undefined, cloudOptions)).toBeUndefined();
  });

  it("returns undefined without a bridge endpoint — HTTP-only, no stdio fallback", () => {
    // The deliberate divergence from both sibling attachments: escalate
    // is cloud-only (OSS refuses FAILED_PRECONDITION) AND
    // session-token-only (a stdio child's API key carries no session_id
    // claim), so a stdio shape could only ever fail. Honest absence.
    expect(
      synthesizeConversationAttachment("chn_1", {
        bridgeEndpoint: null,
        credential: "sandbox-token",
        backendEndpoint: "http://localhost:7234",
      }),
    ).toBeUndefined();
    expect(
      synthesizeConversationAttachment("chn_1", {
        bridgeEndpoint: "",
        credential: "sandbox-token",
        backendEndpoint: "http://localhost:7234",
      }),
    ).toBeUndefined();
  });

  it("builds the HTTP shape against the bridge /conversation route with the credential", () => {
    const attachment = synthesizeConversationAttachment("chn_1", {
      ...cloudOptions,
      bridgeEndpoint: "https://mcp.stigmer.ai/",
    });

    expect(attachment).toMatchObject({
      slug: CONVERSATION_ATTACHMENT_SLUG,
      connectionType: "http",
      url: "https://mcp.stigmer.ai/conversation",
      headers: { Authorization: "Bearer sandbox-token" },
    });
  });

  it("omits the Authorization header without a credential", () => {
    const attachment = synthesizeConversationAttachment("chn_1", {
      ...cloudOptions,
      credential: null,
    });
    expect(attachment?.headers).toBeUndefined();
  });

  it("is approval-free by construction: never listed, so the approval default asks for none of its tools", async () => {
    const attachment = synthesizeConversationAttachment("chn_1", cloudOptions)!;

    // Channel surfaces run APPROVAL_MODE_UNATTENDED, where a gated tool
    // resolves as skip-and-adapt — a gated escalation would never fire
    // (synthesized attachments are approval-free by construction).
    expect(attachment.home, "the platform's own server, no plugin's").toEqual({ kind: "platform" });
    const listing = await listTurnTools([attachment], () => Promise.reject(new Error("a platform server is never listed")));
    expect(listing).toEqual({ listed: [], destructive: [], unlisted: [], offered: [] });
    const mcpDefault = buildMcpApprovalDefault(listing, noLeases);
    expect(mcpDefault.destructive.size).toBe(0);
    expect(mcpDefault.unlisted.size).toBe(0);
  });

});
