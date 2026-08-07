// In-process integration test for the conversation roster (the
// channels.integration.test.ts pattern: real Connect backend with a
// stubbed conversation service, real MCP client over an in-memory
// transport).
//
// Verifies the DD-008 D-b / A14 / A15 contract surface:
//   - the conversation-only roster is exactly escalate_to_human with a
//     single `reason` argument (agent audience — identity is
//     server-derived, so nothing else exists to send);
//   - the success answer is the A15 fixed copy, never the RPC's
//     ChannelConversation row, and claims nothing the platform cannot
//     keep (no console claim until the T04+ surface renders attention);
//   - the conversation-own error mapper passes domain messages verbatim
//     as {error, code} JSON — including NOT_FOUND, this domain's
//     deliberate addition — while transport errors delegate to the
//     shared classifier;
//   - the zod bounds mirror the protovalidate constraints, refusing an
//     empty or over-budget reason before any RPC.

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
import { ChannelConversationCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_command_pb";
import {
  ChannelConversationSchema,
  type EscalateConversationInput,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { CONVERSATION_ROUTE, createConversationServer } from "../../server";

configureLogger({ level: "error", format: "text" });

let backend: Http2Server;
let client: Client;
const openSessions = new Set<ServerHttp2Session>();

/** The next stubbed outcome; tests set this. */
let escalateResponse: () => ReturnType<typeof create<typeof ChannelConversationSchema>>;

/** Requests the stub captured (object property for closure narrowing). */
const captured: { escalate?: EscalateConversationInput } = {};

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function escalate(args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({
    name: "escalate_to_human",
    arguments: args,
  })) as ToolResult;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(ChannelConversationCommandController, {
      escalate: (req) => {
        captured.escalate = req;
        return escalateResponse();
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

  const mcp = createConversationServer({ serverAddress: `127.0.0.1:${port}`, apiKey: "" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "conversation-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("conversation roster (DD-008 D-c / A14)", () => {
  it("exposes exactly escalate_to_human with a single reason argument", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["escalate_to_human"]);

    // The conversation identity is server-derived from the session
    // credential's channel labels (the DD-003 identity doctrine), so
    // reason is the ONLY argument — a channel or conversation id here
    // would be a caller-supplied identity the reach must never trust.
    const properties = (tools[0].inputSchema as { properties?: Record<string, unknown> })
      .properties;
    expect(Object.keys(properties ?? {})).toEqual(["reason"]);
  });

  it("pins the cross-repo route string (the TOOL_CALL_LIMIT precedent)", () => {
    // The runner's conversation-attachment.ts builds the URL
    // independently (shared/conversation-attachment.ts and its route
    // pin); a drift here strands every synthesized attachment on a 404.
    expect(CONVERSATION_ROUTE).toBe("/conversation");
  });
});

describe("the success answer is the A15 copy, not the row", () => {
  it("sends the reason verbatim and answers with fixed copy", async () => {
    escalateResponse = () =>
      create(ChannelConversationSchema, {
        agentChannelId: "agch_1",
        conversationKey: "919000000001",
        needsAttention: true,
        attentionReason: "customer wants a refund decision",
      });
    captured.escalate = undefined;

    const result = await escalate({ reason: "customer wants a refund decision" });

    expect(result.isError).toBeFalsy();
    const req = captured.escalate as EscalateConversationInput | undefined;
    expect(req?.reason).toBe("customer wants a refund decision");

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("recorded on this conversation");
    // A15: the answer instructs against the promise at the moment of
    // temptation — the model's next message to the customer.
    expect(text).toContain("do not");
    // The row must never leak back: its control state and conversation
    // key are internal, and reflecting them invites the model to
    // narrate platform state to the customer.
    expect(text).not.toContain("919000000001");
    expect(text).not.toContain("needs_attention");
    // No console surface renders attention yet (T04+); the copy must
    // not claim one. Delete this pin when the Conversations surface
    // ships and the copy gains the claim.
    expect(text.toLowerCase()).not.toContain("console");
  });
});

describe("zod bounds mirror the protovalidate constraints", () => {
  it("refuses an empty and an over-budget reason before any RPC", async () => {
    captured.escalate = undefined;

    const empty = await escalate({ reason: "" });
    expect(empty.isError).toBe(true);

    const overBudget = await escalate({ reason: "x".repeat(1025) });
    expect(overBudget.isError).toBe(true);

    expect(captured.escalate).toBeUndefined();
  });
});

describe("conversation error mapper", () => {
  it("passes a reach denial through verbatim — never the shared rewrite", async () => {
    escalateResponse = () => {
      throw new ConnectError(
        "escalate is agent-audience only: it requires a session-scoped runner credential",
        Code.PermissionDenied,
      );
    };

    const result = await escalate({ reason: "needs a human" });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "escalate is agent-audience only: it requires a session-scoped runner credential",
      code: "PERMISSION_DENIED",
    });
  });

  it("passes the OSS refusal through verbatim as FAILED_PRECONDITION", async () => {
    escalateResponse = () => {
      throw new ConnectError(
        "conversation participation requires Stigmer Cloud",
        Code.FailedPrecondition,
      );
    };

    const result = await escalate({ reason: "needs a human" });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "conversation participation requires Stigmer Cloud",
      code: "FAILED_PRECONDITION",
    });
  });

  it("passes NOT_FOUND through verbatim — this domain's deliberate addition", async () => {
    // The shared classifier rewrites NotFound into "Verify the org and
    // slug are correct" — advice naming arguments escalate does not
    // take. The domain set includes NotFound so the handler's honest
    // answer reaches the model.
    escalateResponse = () => {
      throw new ConnectError(
        "no conversation with this key exists on channel agch_1",
        Code.NotFound,
      );
    };

    const result = await escalate({ reason: "needs a human" });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "no conversation with this key exists on channel agch_1",
      code: "NOT_FOUND",
    });
  });

  it("delegates transport codes to the shared classifier", async () => {
    escalateResponse = () => {
      throw new ConnectError("upstream down", Code.Unavailable);
    };

    const result = await escalate({ reason: "needs a human" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Stigmer server is unavailable. Ensure it is running and reachable.",
    );
  });
});
