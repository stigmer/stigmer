// MCP tools for the Datastore record domain — the five agent-facing
// record tools of DD-005: 1:1 projections of the record RPCs, with the
// records-own error mapper (errors.ts) and honest MCP annotations (the
// bridge's first use of annotations; the platform's own connect-time
// classifier honors destructiveHint fail-closed for external clients,
// while the runner-synthesized attachment is approval-free by
// construction and never passes through that classifier).
//
// Two audiences, one definition (registered per roster):
//   - "agent" (the records-only roster the runner-synthesized
//     attachment connects to): NO `org` argument — a session-bound
//     caller's org is server-derived from the session, and an explicit
//     org is rejected (T05 R3), so offering the argument would only
//     invite rejected calls.
//   - "direct" (the main roster external MCP clients see): optional
//     `org`, which cloud direct principals must name (their credential
//     carries no ambient org — the DD-006 session-14 amendment). OSS
//     resolves an empty org to the local system org.
// `partition` is deliberately NOT a tool argument for either audience
// (DD-010: never from tool arguments); partition-explicit work is the
// console/CLI/SDK surface.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import {
  deleteRecord,
  describeDatastore,
  findRecords,
  insertRecord,
  updateRecord,
  type ConditionArg,
} from "./calls.js";
import { recordResult } from "./errors.js";

/** Which roster the tools are being registered on (see file header). */
export type RecordToolAudience = "agent" | "direct";

const ENCODINGS =
  "Field value encodings: date YYYY-MM-DD, time HH:MM[:SS], timestamp RFC 3339 UTC " +
  "(e.g. 2026-07-21T04:30:00Z).";

const scalar = z.union([z.string(), z.number(), z.boolean()]);

const conditionShape = z.object({
  field: z
    .string()
    .describe("Declared field name, or a filterable system field (id, created_at, updated_at)."),
  op: z
    .enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "is_null", "not_null"])
    .describe(
      "Comparison operator. eq/neq/in/not_in for string and enum fields; " +
        "gt/gte/lt/lte for numeric and temporal fields; is_null/not_null for optional fields.",
    ),
  value: scalar
    .nullable()
    .optional()
    .describe("Comparison value for scalar operators, in the field's canonical encoding."),
  values: z.array(scalar).optional().describe("Comparison values for in / not_in."),
});

/** Register the five record tools for one audience; returns the tool names. */
export function registerRecordTools(
  server: McpServer,
  target: BackendTarget,
  audience: RecordToolAudience,
): string[] {
  // The org argument exists only on the direct roster (file header).
  const orgShape: { org?: z.ZodOptional<z.ZodString> } = {};
  if (audience === "direct") {
    orgShape.org = z
      .string()
      .optional()
      .describe(
        "Organization that owns the datastore. Required on Stigmer Cloud; " +
          "omit against a local backend.",
      );
  }

  server.registerTool(
    "describe_datastore",
    {
      description:
        "Describe a datastore: its collections, field declarations and encodings, constraint " +
        "messages, data partitions, and the verbs you are allowed to use per collection " +
        "(empty access means you are not allowed to touch that collection). Call this before " +
        `the first record operation against an unfamiliar datastore. ${ENCODINGS}`,
      inputSchema: {
        datastore: z.string().describe("Datastore slug (e.g. clinic)."),
        ...orgShape,
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      recordResult(`datastore "${args.datastore}"`, () =>
        describeDatastore(target.serverAddress, resolveToken(extra, target.apiKey), args),
      ),
  );

  server.registerTool(
    "find_records",
    {
      description:
        "Find records in a datastore collection with a typed filter (conditions are AND-combined). " +
        "Returns records plus total/limit/offset for paging. Results are ordered by created_at " +
        `descending unless order_by is given. ${ENCODINGS}`,
      inputSchema: {
        datastore: z.string().describe("Datastore slug (e.g. clinic)."),
        ...orgShape,
        collection: z.string().describe("Collection to query (e.g. bookings)."),
        conditions: z
          .array(conditionShape)
          .optional()
          .describe("Filter conditions, AND-combined. Omit to list all readable records."),
        order_by: z
          .object({
            field: z.string().describe("Field to sort by."),
            direction: z.enum(["asc", "desc"]).optional().describe("Sort direction (default asc)."),
          })
          .optional()
          .describe("Sort order. Omit for created_at descending with id tiebreak."),
        limit: z.number().int().optional().describe("Page size (default 25, max 100)."),
        offset: z.number().int().optional().describe("Records to skip for paging."),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      recordResult(`records in "${args.datastore}/${args.collection}"`, () =>
        findRecords(target.serverAddress, resolveToken(extra, target.apiKey), {
          ...args,
          conditions: args.conditions as ConditionArg[] | undefined,
        }),
      ),
  );

  server.registerTool(
    "insert_record",
    {
      description:
        "Insert one record into a datastore collection. System fields (id, created_at, " +
        "updated_at, created_by) are server-stamped — never include them. Declared constraints " +
        "are enforced by the store; a violation returns the constraint's message verbatim " +
        "(e.g. a taken slot returns ALREADY_EXISTS — pick another, do not retry the same one). " +
        `When uncertain whether a record already exists, find first. ${ENCODINGS}`,
      inputSchema: {
        datastore: z.string().describe("Datastore slug (e.g. clinic)."),
        ...orgShape,
        collection: z.string().describe("Collection to insert into (e.g. bookings)."),
        record: z
          .record(z.unknown())
          .describe("Declared fields for the new record, in canonical encodings."),
      },
    },
    (args, extra) =>
      recordResult(`record in "${args.datastore}/${args.collection}"`, () =>
        insertRecord(target.serverAddress, resolveToken(extra, target.apiKey), args),
      ),
  );

  server.registerTool(
    "update_record",
    {
      description:
        "Update one record by id with a partial merge: only the supplied fields change, and an " +
        "explicit null clears a field. Constraints are re-evaluated on the merged result. " +
        `Returns the full updated record. ${ENCODINGS}`,
      inputSchema: {
        datastore: z.string().describe("Datastore slug (e.g. clinic)."),
        ...orgShape,
        collection: z.string().describe("Collection holding the record."),
        id: z.string().describe("Record id (from a previous find or insert)."),
        fields: z
          .record(z.unknown())
          .describe("Fields to merge. Explicit null clears a field; omitted fields keep their values."),
      },
      annotations: { idempotentHint: true },
    },
    (args, extra) =>
      recordResult(`record "${args.id}" in "${args.datastore}/${args.collection}"`, () =>
        updateRecord(target.serverAddress, resolveToken(extra, target.apiKey), args),
      ),
  );

  server.registerTool(
    "delete_record",
    {
      description:
        "Delete one record by id. Returns the deleted record. Record tools never delete " +
        "collections or datastores.",
      inputSchema: {
        datastore: z.string().describe("Datastore slug (e.g. clinic)."),
        ...orgShape,
        collection: z.string().describe("Collection holding the record."),
        id: z.string().describe("Record id (from a previous find or insert)."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    (args, extra) =>
      recordResult(`record "${args.id}" in "${args.datastore}/${args.collection}"`, () =>
        deleteRecord(target.serverAddress, resolveToken(extra, target.apiKey), args),
      ),
  );

  return ["describe_datastore", "find_records", "insert_record", "update_record", "delete_record"];
}
