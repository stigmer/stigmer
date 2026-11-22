/**
 * Where a turn's platform attachments connect (`synthesized-attachment.ts`
 * `platformBridge`): a configured bridge for every turn; the stdio child
 * for a conversation with a computer on a runner given none; and the
 * Stigmer server's MCP lane, inferred from the backend endpoint, for one
 * without a computer. Each attachment built on the lane is HTTP at
 * `/v1/mcp/<roster>`, carries the run's credential as its bearer, and is
 * marked inferred; one built on a configured bridge is marked known. The
 * turn-off notice reads the reason it is given.
 */

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RecalledMemoriesSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { MessagingChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/message_io_pb";

import { synthesizeChannelAttachment } from "../channel-attachment.js";
import { synthesizeConversationAttachment } from "../conversation-attachment.js";
import { synthesizeMemoryAttachment } from "../memory-attachment.js";
import {
  PLATFORM_MCP_LANE_PATH,
  platformBridge,
  platformToolsOffNotice,
  serverDidNotAnswer,
  type SynthesizedAttachmentOptions,
} from "../synthesized-attachment.js";

const BACKEND = "http://localhost:7234/";

describe("platformBridge", () => {
  it("is the configured bridge for every turn", () => {
    for (const computer of [true, false]) {
      expect(platformBridge({ mcpBridgeEndpoint: "https://mcp.stigmer.ai", stigmerBackendEndpoint: BACKEND }, computer)).toEqual({
        bridgeEndpoint: "https://mcp.stigmer.ai",
        bridgeInferred: false,
      });
    }
  });

  it("is none (the stdio child) for a conversation with a computer on a runner given no bridge", () => {
    expect(platformBridge({ mcpBridgeEndpoint: null, stigmerBackendEndpoint: BACKEND }, true)).toEqual({ bridgeEndpoint: null, bridgeInferred: false });
    expect(platformBridge({ mcpBridgeEndpoint: "", stigmerBackendEndpoint: BACKEND }, true)).toEqual({ bridgeEndpoint: null, bridgeInferred: false });
  });

  it("is the server's own MCP lane for a conversation without a computer on a runner given no bridge", () => {
    expect(PLATFORM_MCP_LANE_PATH).toBe("/v1/mcp");
    expect(platformBridge({ mcpBridgeEndpoint: null, stigmerBackendEndpoint: BACKEND }, false)).toEqual({
      bridgeEndpoint: "http://localhost:7234/v1/mcp",
      bridgeInferred: true,
    });
  });
});

describe("the attachments on the inferred lane", () => {
  const options: SynthesizedAttachmentOptions = {
    ...platformBridge({ mcpBridgeEndpoint: null, stigmerBackendEndpoint: BACKEND }, false),
    credential: "run-credential",
    backendEndpoint: BACKEND,
  };
  const bearer = { Authorization: "Bearer run-credential" };

  it("reach the lane's routes over HTTP with the run's credential, marked inferred", () => {
    const memory = synthesizeMemoryAttachment(create(RecalledMemoriesSchema, { enabled: true }), { org: "", agentId: "", sessionId: "", agentExecutionId: "" }, options);
    const channels = synthesizeChannelAttachment([{ channel: create(MessagingChannelSchema, {}), templates: [] }], options);
    const conversation = synthesizeConversationAttachment("chn_1", options);
    expect([memory, channels, conversation].map((server) => [server?.connectionType, server?.url, server?.headers, server?.addressedByRunner])).toEqual([
      ["http", "http://localhost:7234/v1/mcp/memory", bearer, "inferred"],
      ["http", "http://localhost:7234/v1/mcp/channels", bearer, "inferred"],
      ["http", "http://localhost:7234/v1/mcp/conversation", bearer, "inferred"],
    ]);
  });

  it("are marked known on a configured bridge", () => {
    const configured: SynthesizedAttachmentOptions = { ...options, ...platformBridge({ mcpBridgeEndpoint: "https://mcp.stigmer.ai", stigmerBackendEndpoint: BACKEND }, false) };
    expect(synthesizeConversationAttachment("chn_1", configured)?.addressedByRunner).toBe("known");
  });
});

describe("platformToolsOffNotice", () => {
  it("names the server that did not answer", () => {
    expect(platformToolsOffNotice(serverDidNotAnswer("http://localhost:7234"))).toBe(
      "The platform's own tools (memory, channel messaging and the conversation tools) are off for this turn: the Stigmer server didn't answer at http://localhost:7234.",
    );
  });
});
