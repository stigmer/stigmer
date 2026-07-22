// In-process integration test for the record tools (search-pattern:
// real Connect backend with stubbed record services, real MCP client
// over an in-memory transport).
//
// Verifies the T05 contract surface:
//   - the records-only roster is exactly the five tools (T05 R1), with
//     honest annotations surfaced through tools/list (pinning the SDK's
//     annotations support) and NO org argument (agent audience);
//   - the main roster carries the same five tools WITH the org argument
//     (direct audience);
//   - argument → request mapping (typed filter, "in" → is_in, paging);
//   - the records-own error mapper: domain errors pass the server's
//     message verbatim as {error, code, reason, constraint} JSON with
//     ErrorInfo companions; transport errors delegate to the shared
//     classifier (DD-005 SD-6).

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
import { DatastoreRecordCommandController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_command_pb";
import {
  DatastoreDescriptionSchema,
  RecordEnvelopeSchema,
  RecordListSchema,
  type FindRecordsRequest,
  type InsertRecordRequest,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { DatastoreRecordQueryController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_query_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { createRecordsServer, createServer } from "../../server";

configureLogger({ level: "error", format: "text" });

const RECORD_TOOLS = [
  "describe_datastore",
  "find_records",
  "insert_record",
  "update_record",
  "delete_record",
];

let backend: Http2Server;
let client: Client;
const openSessions = new Set<ServerHttp2Session>();

/** The next stubbed outcome per RPC; tests set these. */
let findResponse: () => ReturnType<typeof create<typeof RecordListSchema>>;
let insertOutcome: () => ReturnType<typeof create<typeof RecordEnvelopeSchema>>;

/**
 * Requests the stubs captured. An object (not two `let`s) because TS
 * does not reset let-narrowing across awaited calls for closure
 * assignments — property narrowing it does.
 */
const captured: {
  find?: FindRecordsRequest;
  insert?: InsertRecordRequest;
} = {};

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(DatastoreRecordQueryController, {
      findRecords: (req) => {
        captured.find = req;
        return findResponse();
      },
      describeDatastore: () =>
        create(DatastoreDescriptionSchema, {
          datastore: "clinic",
          timezone: "Asia/Kolkata",
          partitions: ["default"],
        }),
    });
    router.service(DatastoreRecordCommandController, {
      insertRecord: (req) => {
        captured.insert = req;
        return insertOutcome();
      },
      updateRecord: () => create(RecordEnvelopeSchema, { id: "dsr_updated" }),
      deleteRecord: () => create(RecordEnvelopeSchema, { id: "dsr_deleted" }),
    });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;

  // The records-only roster is the surface under test — the audience
  // the runner-synthesized attachment serves.
  const mcp = createRecordsServer({ serverAddress: `127.0.0.1:${port}`, apiKey: "" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "records-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("records roster (T05 R1)", () => {
  it("exposes exactly the five record tools with honest annotations and no org argument", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...RECORD_TOOLS].sort());

    const byName = new Map(tools.map((t) => [t.name, t]));
    // Annotations are part of the DD-005 contract for external clients
    // and the classifier; this pins the SDK actually surfacing them.
    expect(byName.get("find_records")?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get("describe_datastore")?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get("update_record")?.annotations).toMatchObject({ idempotentHint: true });
    expect(byName.get("delete_record")?.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    });

    // The agent audience gets no org argument — a session-bound
    // caller's org is server-derived, and offering the argument would
    // only invite INVALID_ARGUMENT rejections (T05 R3).
    for (const tool of tools) {
      const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
      expect(Object.keys(properties ?? {}), tool.name).not.toContain("org");
    }
  });

  it("the main roster carries the five tools WITH the org argument", async () => {
    // Direct principals (external MCP clients) must be able to name the
    // org their credential does not carry (DD-006 session-14 amendment).
    const full = createServer({ serverAddress: "127.0.0.1:1", apiKey: "" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const fullClient = new Client({ name: "records-full-roster", version: "test" });
    await Promise.all([full.connect(serverTransport), fullClient.connect(clientTransport)]);
    try {
      const { tools } = await fullClient.listTools();
      const names = tools.map((t) => t.name);
      for (const name of RECORD_TOOLS) {
        expect(names).toContain(name);
      }
      const find = tools.find((t) => t.name === "find_records");
      const properties = (find?.inputSchema as { properties?: Record<string, unknown> })
        .properties;
      expect(Object.keys(properties ?? {})).toContain("org");
    } finally {
      await fullClient.close();
    }
  });
});

describe("argument → request mapping", () => {
  it("builds the typed filter (in → is_in), order_by, and paging", async () => {
    findResponse = () =>
      create(RecordListSchema, {
        records: [create(RecordEnvelopeSchema, { id: "dsr_1" })],
        total: 1,
        limit: 25,
      });
    captured.find = undefined;

    const result = await callTool("find_records", {
      datastore: "clinic",
      collection: "bookings",
      conditions: [
        { field: "status", op: "eq", value: "confirmed" },
        { field: "patient_name", op: "in", values: ["Asha", "Ravi"] },
      ],
      order_by: { field: "slot_start", direction: "desc" },
      limit: 10,
      offset: 20,
    });

    expect(result.isError).toBeFalsy();
    // Assertion, not annotation: control-flow analysis otherwise pins the
    // const to the `= undefined` reset above (the stub assigns in a
    // closure the analysis cannot see across the await).
    const req = captured.find as FindRecordsRequest | undefined;
    expect(req?.datastore).toBe("clinic");
    expect(req?.org).toBe(""); // agent audience: org never travels
    expect(req?.partition).toBe(""); // partition is never a tool argument (DD-010)
    expect(req?.filter?.conditions).toHaveLength(2);
    expect(req?.filter?.conditions[0]).toMatchObject({ field: "status", op: 1 /* eq */ });
    expect(req?.filter?.conditions[1]).toMatchObject({ field: "patient_name", op: 7 /* is_in */ });
    expect(req?.filter?.conditions[1]?.values).toHaveLength(2);
    expect(req?.orderBy).toMatchObject({ field: "slot_start", direction: 2 /* desc */ });
    expect(req?.limit).toBe(10);
    expect(req?.offset).toBe(20);

    const body = JSON.parse(result.content[0]?.text ?? "{}") as { total?: number };
    expect(body.total).toBe(1);
  });

  it("passes the record payload through as a Struct, untouched", async () => {
    insertOutcome = () => create(RecordEnvelopeSchema, { id: "dsr_new" });
    captured.insert = undefined;

    const result = await callTool("insert_record", {
      datastore: "clinic",
      collection: "bookings",
      record: { slot_start: "2026-07-21T04:30:00Z", patient_name: "Asha" },
    });

    expect(result.isError).toBeFalsy();
    const req = captured.insert as InsertRecordRequest | undefined;
    expect(req?.record).toMatchObject({
      slot_start: "2026-07-21T04:30:00Z",
      patient_name: "Asha",
    });
  });
});

describe("records error mapper (DD-005 SD-6)", () => {
  it("passes a constraint violation through verbatim with ErrorInfo companions", async () => {
    insertOutcome = () => {
      throw new ConnectError("that slot is already booked", Code.AlreadyExists, undefined, [
        {
          desc: ErrorInfoSchema,
          value: create(ErrorInfoSchema, {
            reason: "CONSTRAINT_VIOLATION",
            domain: "datastore.stigmer.ai",
            metadata: { constraint: "one_confirmed_per_slot" },
          }),
        },
      ]);
    };

    const result = await callTool("insert_record", {
      datastore: "clinic",
      collection: "bookings",
      record: { slot_start: "2026-07-21T04:30:00Z", patient_name: "Ravi" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "that slot is already booked",
      code: "ALREADY_EXISTS",
      reason: "CONSTRAINT_VIOLATION",
      constraint: "one_confirmed_per_slot",
    });
  });

  it("passes a permission denial through verbatim — never the shared rewrite", async () => {
    insertOutcome = () => {
      throw new ConnectError(
        "you are not allowed to insert records in schedule_exceptions",
        Code.PermissionDenied,
        undefined,
        [
          {
            desc: ErrorInfoSchema,
            value: create(ErrorInfoSchema, {
              reason: "VERB_DENIED",
              domain: "datastore.stigmer.ai",
            }),
          },
        ],
      );
    };

    const result = await callTool("insert_record", {
      datastore: "clinic",
      collection: "schedule_exceptions",
      record: { exception_date: "2026-07-22" },
    });

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, string>;
    // The relayable domain bytes — NOT "Check your API key permissions".
    expect(body.error).toBe("you are not allowed to insert records in schedule_exceptions");
    expect(body.code).toBe("PERMISSION_DENIED");
    expect(body.reason).toBe("VERB_DENIED");
    expect(body.constraint).toBeUndefined();
  });

  it("delegates transport codes to the shared classifier", async () => {
    findResponse = () => {
      throw new ConnectError("upstream down", Code.Unavailable);
    };

    const result = await callTool("find_records", {
      datastore: "clinic",
      collection: "bookings",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Stigmer server is unavailable. Ensure it is running and reachable.",
    );
  });
});
