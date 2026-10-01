// In-process integration test for the channels roster (the
// records.integration.test.ts pattern: real Connect backend with a
// stubbed messaging service, real MCP client over an in-memory
// transport).
//
// Verifies the DD-006 D5/D8 contract surface:
//   - the channels-only roster is exactly send_channel_message with NO
//     org argument (agent audience);
//   - argument → request mapping mirrors the ChannelOutboundPayload
//     oneof (text | template, exactly one, checked before any RPC);
//   - typed outcomes (accepted/queued/refused) are ANSWERS — success
//     results the model adapts to, never isError;
//   - the channels-own error mapper passes domain messages verbatim as
//     {error, code, reason} JSON; transport errors delegate to the
//     shared classifier.

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  createServer as createHttp2Server,
  type Http2Server,
  type ServerHttp2Session,
} from "node:http2";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ChannelMessageCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_command_pb";
import {
  ChannelSendOutcome,
  SendChannelMessageOutputSchema,
  type SendChannelMessageInput,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { CHANNELS_ROUTE, createChannelsServer } from "../../server";

configureLogger({ level: "error", format: "text" });

let backend: Http2Server;
let client: Client;
const openSessions = new Set<ServerHttp2Session>();

/** The next stubbed outcome; tests set this. */
let sendResponse: () => ReturnType<typeof create<typeof SendChannelMessageOutputSchema>>;

/** Requests the stub captured (object property for closure narrowing). */
const captured: { send?: SendChannelMessageInput } = {};

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function send(args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({
    name: "send_channel_message",
    arguments: args,
  })) as ToolResult;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(ChannelMessageCommandController, {
      sendMessage: (req) => {
        captured.send = req;
        return sendResponse();
      },
    });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;

  const mcp = createChannelsServer({ serverAddress: `127.0.0.1:${port}`, apiKey: "" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "channels-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("channels roster (DD-006 D8)", () => {
  it("exposes exactly send_channel_message with no org argument", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["send_channel_message"]);

    // The agent audience gets no org argument — a session-bound
    // caller's org is server-derived, and offering the argument would
    // only invite INVALID_ARGUMENT rejections (the records T05 R3 rule).
    const properties = (tools[0].inputSchema as { properties?: Record<string, unknown> })
      .properties;
    expect(Object.keys(properties ?? {}).sort()).toEqual([
      "channel",
      "recipient",
      "template",
      "text",
    ]);
  });

  it("pins the cross-repo attachment strings (the TOOL_CALL_LIMIT precedent)", () => {
    // The runner's channel-attachment.ts builds these independently
    // (shared/channel-attachment.ts and its mirror guard); a drift here
    // strands every synthesized attachment on a 404 or a full roster.
    expect(CHANNELS_ROUTE).toBe("/channels");
  });
});

describe("argument → request mapping (the ChannelOutboundPayload oneof)", () => {
  it("maps a text send; org never travels, channel defaults empty", async () => {
    sendResponse = () =>
      create(SendChannelMessageOutputSchema, {
        outcome: ChannelSendOutcome.accepted,
        outboundMessageId: "chom_1",
        providerMessageId: "wamid.abc",
      });
    captured.send = undefined;

    const result = await send({ recipient: "919000000001", text: "see you at 6" });

    expect(result.isError).toBeFalsy();
    const req = captured.send as SendChannelMessageInput | undefined;
    expect(req?.recipient).toBe("919000000001");
    expect(req?.org).toBe(""); // agent audience: org never travels
    expect(req?.channel).toBe("");
    expect(req?.payload?.kind.case).toBe("text");
    expect(req?.payload?.kind.case === "text" && req.payload.kind.value.body).toBe("see you at 6");

    // toProtoJson emits proto (snake_case) field names — the Go parity rule.
    const body = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, string>;
    expect(body.outcome).toBe("accepted");
    expect(body.provider_message_id).toBe("wamid.abc");
  });

  it("maps a template send with language, parameters, header link, and a named channel", async () => {
    sendResponse = () =>
      create(SendChannelMessageOutputSchema, { outcome: ChannelSendOutcome.accepted });
    captured.send = undefined;

    const result = await send({
      recipient: "919000000001",
      channel: "isc-whatsapp",
      template: {
        name: "invoice_qr",
        language: "en",
        parameters: { member_name: "Asha", amount: "1500" },
        header_image_link: "https://isc.example/qr.png",
      },
    });

    expect(result.isError).toBeFalsy();
    const req = captured.send as SendChannelMessageInput | undefined;
    expect(req?.channel).toBe("isc-whatsapp");
    expect(req?.payload?.kind.case).toBe("template");
    if (req?.payload?.kind.case === "template") {
      expect(req.payload.kind.value.name).toBe("invoice_qr");
      expect(req.payload.kind.value.language).toBe("en");
      expect(req.payload.kind.value.parameters).toMatchObject({
        member_name: "Asha",
        amount: "1500",
      });
      expect(req.payload.kind.value.headerImageLink).toBe("https://isc.example/qr.png");
    }
  });

  it("refuses both/neither arms with corrective copy, before any RPC", async () => {
    captured.send = undefined;

    const both = await send({
      recipient: "919000000001",
      text: "hi",
      template: { name: "fee_reminder" },
    });
    expect(both.isError).toBe(true);
    expect(both.content[0]?.text).toContain("exactly one of text | template");

    const neither = await send({ recipient: "919000000001" });
    expect(neither.isError).toBe(true);
    expect(neither.content[0]?.text).toContain("exactly one of text | template");

    expect(captured.send).toBeUndefined();
  });
});

describe("typed outcomes are answers, not errors (DD-002 D4)", () => {
  it("a refused outcome returns as a SUCCESS result carrying the detail", async () => {
    sendResponse = () =>
      create(SendChannelMessageOutputSchema, {
        outcome: ChannelSendOutcome.refused,
        outboundMessageId: "",
        detail:
          "recipient has not messaged this channel — proactive sends from a channel"
          + " conversation are limited to known senders",
      });

    const result = await send({ recipient: "919000000002", text: "hello" });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, string>;
    expect(body.outcome).toBe("refused");
    expect(body.detail).toContain("known senders");
  });
});

describe("channels error mapper", () => {
  it("passes a reach denial through verbatim — never the shared rewrite", async () => {
    sendResponse = () => {
      throw new ConnectError(
        "this agent has no proactive-messaging channel it can use",
        Code.PermissionDenied,
      );
    };

    const result = await send({ recipient: "919000000001", text: "hello" });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "this agent has no proactive-messaging channel it can use",
      code: "PERMISSION_DENIED",
    });
  });

  it("carries the ErrorInfo reason on operator-actionable preconditions (DD-005 D8)", async () => {
    sendResponse = () => {
      throw new ConnectError(
        "proactive channel messaging requires Stigmer Cloud",
        Code.FailedPrecondition,
        undefined,
        [
          {
            desc: ErrorInfoSchema,
            value: create(ErrorInfoSchema, {
              reason: "WHATSAPP_MANAGEMENT_SCOPE_MISSING",
              domain: "stigmer.ai",
            }),
          },
        ],
      );
    };

    const result = await send({ recipient: "919000000001", text: "hello" });

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, string>;
    expect(body.code).toBe("FAILED_PRECONDITION");
    expect(body.reason).toBe("WHATSAPP_MANAGEMENT_SCOPE_MISSING");
  });

  it("delegates transport codes to the shared classifier", async () => {
    sendResponse = () => {
      throw new ConnectError("upstream down", Code.Unavailable);
    };

    const result = await send({ recipient: "919000000001", text: "hello" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Stigmer server is unavailable. Ensure it is running and reachable.",
    );
  });
});
