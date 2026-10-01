// In-process integration test for the memory roster (the
// channels.integration.test.ts pattern: real Connect backend with a
// stubbed memory service, real MCP client over an in-memory transport).
//
// Verifies the DD-005 D1/D2 contract surface:
//   - the memory-only roster is exactly remember with ONLY a fact
//     argument (agent audience; org, subject, and provenance are never
//     the model's to supply);
//   - argument + capture-context → request mapping: fact → spec.content,
//     context org → metadata.org, context triple → spec.provenance,
//     subject never travels, tool_call_id stays empty (v1);
//   - the answer is the chip contract: { outcome, memory } with the
//     created record as verbatim proto JSON and the honest
//     proposed-not-remembered outcome line;
//   - the memory-own error mapper passes domain messages verbatim as
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
import { MemorySchema, type Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryCommandController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/command_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { MemorySpecSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/spec_pb";
import { MemoryStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { MEMORY_ROUTE, createMemoryServer } from "../../server";
import { PROPOSED_OUTCOME } from "./calls";
import {
  MEMORY_AGENT_ID_ENV,
  MEMORY_AGENT_ID_HEADER,
  MEMORY_EXECUTION_ID_ENV,
  MEMORY_EXECUTION_ID_HEADER,
  MEMORY_ORG_ENV,
  MEMORY_ORG_HEADER,
  MEMORY_SESSION_ID_ENV,
  MEMORY_SESSION_ID_HEADER,
} from "./context";

configureLogger({ level: "error", format: "text" });

let backend: Http2Server;
let client: Client;
const openSessions = new Set<ServerHttp2Session>();

/** The next stubbed created record; tests set this. */
let createResponse: () => Memory;

// Requests the stub captured. An array, deliberately: resetting an optional
// property to undefined narrows its type to `undefined` for the rest of the
// flow (tsc does not un-narrow across the intervening callTool call), which
// makes every later `req?.x` a property access on `never` under
// `npm run typecheck` — the job that, unlike tsconfig.build.json, includes
// tests. Clearing and reading an array never narrows.
const capturedCreates: Memory[] = [];

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function remember(args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name: "remember", arguments: args })) as ToolResult;
}

/** A plausible created record echoing the request's content. */
function proposedRecord(content: string): Memory {
  return create(MemorySchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Memory",
    metadata: create(ApiResourceMetadataSchema, { id: "mem_01test", org: "acme" }),
    spec: create(MemorySpecSchema, {
      content,
      subjectIdentityAccountId: "ida_subject",
    }),
    status: create(MemoryStatusSchema, {
      lifecycleState: MemoryLifecycleState.lifecycle_state_proposed,
    }),
  });
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(MemoryCommandController, {
      create: (req) => {
        capturedCreates.push(req);
        return createResponse();
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

  // The stdio shape: the startup capture context stands in for the
  // runner-set STIGMER_MEMORY_* environment.
  const mcp = createMemoryServer(
    { serverAddress: `127.0.0.1:${port}`, apiKey: "" },
    { org: "acme", agentId: "agt_1", sessionId: "ses_1", agentExecutionId: "aex_1" },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "memory-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("memory roster (DD-005 D1)", () => {
  it("exposes exactly remember with only a fact argument", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["remember"]);

    // The agent audience supplies the fact and NOTHING else — org,
    // subject, and provenance derive from the credential and the
    // runner-threaded capture context, so no argument exists to forge
    // them (the channels no-org rule, applied to attribution).
    const properties = (tools[0].inputSchema as { properties?: Record<string, unknown> })
      .properties;
    expect(Object.keys(properties ?? {})).toEqual(["fact"]);
  });

  it("pins the cross-repo attachment strings (the TOOL_CALL_LIMIT precedent)", () => {
    // The runner's memory-attachment.ts builds these independently; a
    // drift strands every synthesized attachment on a 404 (route) or an
    // attribution-less record (context keys).
    expect(MEMORY_ROUTE).toBe("/memory");
    expect(MEMORY_ORG_ENV).toBe("STIGMER_MEMORY_ORG");
    expect(MEMORY_AGENT_ID_ENV).toBe("STIGMER_MEMORY_AGENT_ID");
    expect(MEMORY_SESSION_ID_ENV).toBe("STIGMER_MEMORY_SESSION_ID");
    expect(MEMORY_EXECUTION_ID_ENV).toBe("STIGMER_MEMORY_EXECUTION_ID");
    expect(MEMORY_ORG_HEADER).toBe("x-stigmer-memory-org");
    expect(MEMORY_AGENT_ID_HEADER).toBe("x-stigmer-memory-agent-id");
    expect(MEMORY_SESSION_ID_HEADER).toBe("x-stigmer-memory-session-id");
    expect(MEMORY_EXECUTION_ID_HEADER).toBe("x-stigmer-memory-execution-id");
  });
});

describe("argument + capture context → request mapping (DD-005 D2)", () => {
  it("maps the fact and the startup context; subject never travels", async () => {
    createResponse = () => proposedRecord("Prefers concise answers.");
    capturedCreates.length = 0;

    const result = await remember({ fact: "Prefers concise answers." });

    expect(result.isError).toBeFalsy();
    const req = capturedCreates.at(-1);
    expect(req?.metadata?.org).toBe("acme");
    expect(req?.metadata?.name).toBe(""); // id-addressed; the server defaults the name
    expect(req?.spec?.content).toBe("Prefers concise answers.");
    // Subject is the server's to derive from the credential — the tool
    // never supplies one, so forgery is structurally impossible.
    expect(req?.spec?.subjectIdentityAccountId).toBe("");
    expect(req?.spec?.provenance?.agentId).toBe("agt_1");
    expect(req?.spec?.provenance?.sessionId).toBe("ses_1");
    expect(req?.spec?.provenance?.agentExecutionId).toBe("aex_1");
    // v1: MCP does not carry the harness's tool-call identity.
    expect(req?.spec?.provenance?.toolCallId).toBe("");
  });

  it("answers with the chip contract: outcome line + created record as proto JSON", async () => {
    createResponse = () => proposedRecord("Works primarily in Go.");

    const result = await remember({ fact: "Works primarily in Go." });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0]?.text ?? "{}") as {
      outcome?: string;
      memory?: Record<string, unknown>;
    };
    // The honest relay (DD-005 D2): proposed, the user decides.
    expect(body.outcome).toBe(PROPOSED_OUTCOME);
    // The record rides verbatim with proto (snake_case) field names —
    // what the SDK's normalizeToolResult parses to render the chip.
    const memory = body.memory as {
      metadata?: { id?: string };
      spec?: { content?: string };
      status?: { lifecycle_state?: string };
    };
    expect(memory?.metadata?.id).toBe("mem_01test");
    expect(memory?.spec?.content).toBe("Works primarily in Go.");
    expect(memory?.status?.lifecycle_state).toBe("lifecycle_state_proposed");
  });
});

describe("memory error mapper", () => {
  it("passes the visible-full refusal through verbatim — never the shared rewrite", async () => {
    createResponse = () => {
      throw new ConnectError(
        "memory is full — review and delete existing memories",
        Code.FailedPrecondition,
      );
    };

    const result = await remember({ fact: "One fact too many." });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "memory is full — review and delete existing memories",
      code: "FAILED_PRECONDITION",
    });
  });

  it("passes the caller-gate refusal through verbatim", async () => {
    createResponse = () => {
      throw new ConnectError(
        "memory capture is limited to first-party sessions",
        Code.PermissionDenied,
      );
    };

    const result = await remember({ fact: "A fact from the wrong caller." });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "memory capture is limited to first-party sessions",
      code: "PERMISSION_DENIED",
    });
  });

  it("delegates transport codes to the shared classifier", async () => {
    createResponse = () => {
      throw new ConnectError("upstream down", Code.Unavailable);
    };

    const result = await remember({ fact: "Any fact." });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Stigmer server is unavailable. Ensure it is running and reachable.",
    );
  });
});
