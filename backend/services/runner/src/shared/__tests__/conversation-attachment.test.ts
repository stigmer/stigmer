/**
 * The conversation participation attachment (channel-conversations
 * DD-008 D-c, A14): the label-keyed attachment decision, the HTTP-only
 * shape (the deliberate no-stdio divergence from both siblings), the
 * structural approval-freedom, and the pinned strings. The route is the
 * cross-repo string — pinned here and in the mcp-server's conversation
 * integration test (the TOOL_CALL_LIMIT precedent); the label is pinned
 * here and in the cloud's ChannelSessionBrokerTest (the sender-identity
 * mirror-guard precedent).
 */

import { describe, expect, it } from "vitest";

import { mergeApprovalPolicies, type ActiveLeases } from "../approval-policy.js";
import { needsBackfill } from "../connect-backfill.js";
import {
  CHANNEL_ID_LABEL,
  CONVERSATION_ATTACHMENT_SLUG,
  CONVERSATION_ROUTE,
  readChannelConversationId,
  synthesizeConversationAttachment,
} from "../conversation-attachment.js";

const noLeases: ActiveLeases = {
  global: false,
  categories: new Set(),
  servers: new Set(),
};

const cloudOptions = {
  bridgeEndpoint: "https://mcp.stigmer.ai",
  credential: "sandbox-token",
  backendEndpoint: "http://localhost:7234",
};

describe("cross-repo and cross-file pinned strings", () => {
  it("pins the label verbatim to the cloud's ChannelRuntimeConstants (mirror guard)", () => {
    // Pinned to ChannelRuntimeConstants.CHANNEL_ID_METADATA_KEY in
    // stigmer-cloud (ChannelSessionCreateScopeStep stamps it; the
    // mirror-guard test lives in ChannelSessionBrokerTest). Drift
    // degrades to honest absence — the escalation tool silently stops
    // attaching — never worse; change BOTH sides together.
    expect(CHANNEL_ID_LABEL).toBe("stigmer.ai/channel-id");
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
  it("reads the serving channel id from the session labels", () => {
    expect(readChannelConversationId({ [CHANNEL_ID_LABEL]: "agch_1" })).toBe("agch_1");
  });

  it("treats missing labels, a missing key, and blank values as absent", () => {
    expect(readChannelConversationId(undefined)).toBeUndefined();
    expect(readChannelConversationId({})).toBeUndefined();
    expect(readChannelConversationId({ [CHANNEL_ID_LABEL]: "" })).toBeUndefined();
    expect(readChannelConversationId({ [CHANNEL_ID_LABEL]: "   " })).toBeUndefined();
  });

  it("ignores unrelated labels", () => {
    expect(
      readChannelConversationId({ "stigmer.ai/channel-conversation-key": "919000000001" }),
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
      synthesizeConversationAttachment("agch_1", {
        bridgeEndpoint: null,
        credential: "sandbox-token",
        backendEndpoint: "http://localhost:7234",
      }),
    ).toBeUndefined();
    expect(
      synthesizeConversationAttachment("agch_1", {
        bridgeEndpoint: "",
        credential: "sandbox-token",
        backendEndpoint: "http://localhost:7234",
      }),
    ).toBeUndefined();
  });

  it("builds the HTTP shape against the bridge /conversation route with the credential", () => {
    const attachment = synthesizeConversationAttachment("agch_1", {
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
    const attachment = synthesizeConversationAttachment("agch_1", {
      ...cloudOptions,
      credential: null,
    });
    expect(attachment?.headers).toBeUndefined();
  });

  it("is approval-free by construction: zero entries in the merged approval map", () => {
    const attachment = synthesizeConversationAttachment("agch_1", cloudOptions)!;

    // Channel surfaces run APPROVAL_MODE_UNATTENDED, where a gated tool
    // resolves as skip-and-adapt — a gated escalation would never fire
    // (DD-008's approval-free ruling, the DD-001 SD-3 structural bypass).
    const merged = mergeApprovalPolicies([attachment], noLeases);
    expect(merged.size).toBe(0);
  });

  it("is structurally immune to the connect backfill", () => {
    const attachment = synthesizeConversationAttachment("agch_1", cloudOptions)!;
    expect(attachment.discoveredCapabilitiesEmpty).toBe(false);
    expect(needsBackfill(attachment)).toBe(false);
  });
});
