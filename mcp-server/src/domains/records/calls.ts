// Record-RPC invocations for the five record tools — 1:1 projections
// of DatastoreRecordQueryController / DatastoreRecordCommandController
// (DD-005: the tool layer adds no semantics; validation, grants,
// scopes, constraints, and messages all live in record-RPC domain
// logic on the control plane).
//
// One file for the five thin calls rather than the resource domains'
// file-per-verb split: resource verbs each carry orchestration
// (reference resolution, YAML parsing, two-step deletes); record calls
// are each "build request, call, marshal" and the shared argument
// mapping (filter/value building) is the only substance.

import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { ValueSchema, type Value } from "@bufbuild/protobuf/wkt";
import {
  DatastoreRecordCommandController,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_command_pb";
import {
  DatastoreRecordQueryController,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_query_pb";
import {
  DatastoreDescriptionSchema,
  DeleteRecordRequestSchema,
  DescribeDatastoreRequestSchema,
  FindRecordsRequestSchema,
  InsertRecordRequestSchema,
  RecordConditionOp,
  RecordConditionSchema,
  RecordEnvelopeSchema,
  RecordFilterSchema,
  RecordListSchema,
  RecordOrderBySchema,
  RecordSortDirection,
  UpdateRecordRequestSchema,
  type RecordCondition,
  type RecordFilter,
  type RecordOrderBy,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";

/**
 * A filter condition as the model supplies it. `op` uses the natural
 * spelling "in" (the proto enum's `is_in` exists only because `in` is
 * reserved in Java/Python — a substrate detail the model never sees).
 */
export interface ConditionArg {
  field: string;
  op: string;
  value?: string | number | boolean | null;
  values?: (string | number | boolean)[];
}

export interface FindArgs {
  datastore: string;
  org?: string;
  collection: string;
  conditions?: ConditionArg[];
  order_by?: { field: string; direction?: string };
  limit?: number;
  offset?: number;
}

/** Model-facing operator spelling → proto enum. */
const CONDITION_OPS: Readonly<Record<string, RecordConditionOp>> = {
  eq: RecordConditionOp.eq,
  neq: RecordConditionOp.neq,
  gt: RecordConditionOp.gt,
  gte: RecordConditionOp.gte,
  lt: RecordConditionOp.lt,
  lte: RecordConditionOp.lte,
  in: RecordConditionOp.is_in,
  not_in: RecordConditionOp.not_in,
  is_null: RecordConditionOp.is_null,
  not_null: RecordConditionOp.not_null,
};

export async function findRecords(
  serverAddress: string,
  token: string,
  args: FindArgs,
): Promise<string> {
  const request = create(FindRecordsRequestSchema, {
    datastore: args.datastore,
    org: args.org ?? "",
    collection: args.collection,
    filter: buildFilter(args.conditions),
    orderBy: buildOrderBy(args.order_by),
    limit: args.limit ?? 0,
    offset: args.offset ?? 0,
  });
  return withClient(DatastoreRecordQueryController, serverAddress, token, async (client, opts) =>
    toProtoJson(RecordListSchema, await client.findRecords(request, opts)),
  );
}

export async function insertRecord(
  serverAddress: string,
  token: string,
  args: { datastore: string; org?: string; collection: string; record: Record<string, unknown> },
): Promise<string> {
  const request = create(InsertRecordRequestSchema, {
    datastore: args.datastore,
    org: args.org ?? "",
    collection: args.collection,
    // google.protobuf.Struct fields are plain JSON objects in
    // protobuf-es v2 — no conversion.
    record: args.record as JsonObject,
  });
  return withClient(DatastoreRecordCommandController, serverAddress, token, async (client, opts) =>
    toProtoJson(RecordEnvelopeSchema, await client.insertRecord(request, opts)),
  );
}

export async function updateRecord(
  serverAddress: string,
  token: string,
  args: {
    datastore: string;
    org?: string;
    collection: string;
    id: string;
    fields: Record<string, unknown>;
  },
): Promise<string> {
  const request = create(UpdateRecordRequestSchema, {
    datastore: args.datastore,
    org: args.org ?? "",
    collection: args.collection,
    id: args.id,
    fields: args.fields as JsonObject,
  });
  return withClient(DatastoreRecordCommandController, serverAddress, token, async (client, opts) =>
    toProtoJson(RecordEnvelopeSchema, await client.updateRecord(request, opts)),
  );
}

export async function deleteRecord(
  serverAddress: string,
  token: string,
  args: { datastore: string; org?: string; collection: string; id: string },
): Promise<string> {
  const request = create(DeleteRecordRequestSchema, {
    datastore: args.datastore,
    org: args.org ?? "",
    collection: args.collection,
    id: args.id,
  });
  return withClient(DatastoreRecordCommandController, serverAddress, token, async (client, opts) =>
    toProtoJson(RecordEnvelopeSchema, await client.deleteRecord(request, opts)),
  );
}

export async function describeDatastore(
  serverAddress: string,
  token: string,
  args: { datastore: string; org?: string },
): Promise<string> {
  const request = create(DescribeDatastoreRequestSchema, {
    datastore: args.datastore,
    org: args.org ?? "",
  });
  return withClient(DatastoreRecordQueryController, serverAddress, token, async (client, opts) =>
    toProtoJson(DatastoreDescriptionSchema, await client.describeDatastore(request, opts)),
  );
}

/**
 * Build the typed AND-only filter (DD-005 SD-2). An unknown operator is
 * left unspecified for the server to reject with its own domain
 * message — the bridge never fabricates validation of its own.
 */
function buildFilter(conditions: ConditionArg[] | undefined): RecordFilter | undefined {
  if (conditions === undefined || conditions.length === 0) {
    return undefined;
  }
  return create(RecordFilterSchema, {
    conditions: conditions.map(buildCondition),
  });
}

function buildCondition(arg: ConditionArg): RecordCondition {
  return create(RecordConditionSchema, {
    field: arg.field,
    op: CONDITION_OPS[arg.op] ?? RecordConditionOp.record_condition_op_unspecified,
    value: arg.value !== undefined ? scalarValue(arg.value) : undefined,
    values: (arg.values ?? []).map(scalarValue),
  });
}

function buildOrderBy(
  orderBy: { field: string; direction?: string } | undefined,
): RecordOrderBy | undefined {
  if (orderBy === undefined) {
    return undefined;
  }
  return create(RecordOrderBySchema, {
    field: orderBy.field,
    direction: orderBy.direction === "desc"
      ? RecordSortDirection.desc
      : orderBy.direction === "asc"
        ? RecordSortDirection.asc
        : RecordSortDirection.record_sort_direction_unspecified,
  });
}

function scalarValue(v: string | number | boolean | null): Value {
  return fromJson(ValueSchema, v);
}
