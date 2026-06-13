// Spike B — recursive apply-input schema (unblocking apply_workflow).
//
// Question this proves: the Go apply_workflow tool is disabled because
// jsonschema-go v0.4.2 cannot express the recursive WorkflowTask type
// (`repeated WorkflowTask compensate`). Can the TS toolchain express that
// recursion AND have the MCP SDK accept it as a tool input schema?
//
// Three proofs:
//   1. protobuf-es handles the recursive proto natively (create + toJson
//      round-trips a task whose compensation nests another task).
//   2. A recursive Zod schema DERIVED FROM THE PROTO DESCRIPTOR (z.lazy on
//      message refs) validates the same object and round-trips through a
//      `create`-based ToProto equivalent.
//   3. registerTool accepts that schema and MCP discovery (`tools/list`)
//      surfaces it as JSON Schema with `$ref` (recursion by reference) — the
//      exact thing jsonschema-go could not produce.
//
// Mechanism selected: (a) a descriptor walker over protobuf-es `DescMessage`.
// protobuf-es already ships the descriptors, so no extra buf plugin (option b)
// and no divergent hand-maintained intermediate schemas (option c) are needed.
//
// Ergonomic-projection gap (flagged for T02): this derives the RAW proto shape.
// `task_config` is a google.protobuf.Struct, so fork/for_each nested tasks are
// untyped JSON here, and only `compensate` is typed recursion. The Go ergonomic
// input instead HOISTS metadata and EXPANDS task_config into one typed config
// per kind (adding typed fork/for_each nested-task recursion). Reconciling
// "derive from proto" (DD-005) with that hand-friendly shape is a T02 decision.

import { create, toJson, ScalarType, type DescField, type DescMessage } from "@bufbuild/protobuf";
import {
  WorkflowTaskSchema,
  type WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// --- the descriptor walker (prototype for the T02 derivation, option a) ---

function scalarToZod(scalar: ScalarType): z.ZodTypeAny {
  switch (scalar) {
    case ScalarType.STRING:
      return z.string();
    case ScalarType.BOOL:
      return z.boolean();
    case ScalarType.BYTES:
      return z.string(); // base64 in protojson
    // 64-bit integers serialize as strings in protojson but init accepts both.
    case ScalarType.INT64:
    case ScalarType.UINT64:
    case ScalarType.SINT64:
    case ScalarType.FIXED64:
    case ScalarType.SFIXED64:
      return z.union([z.string(), z.number(), z.bigint()]);
    default:
      return z.number();
  }
}

function messageRef(desc: DescMessage, cache: Map<string, z.ZodTypeAny>): z.ZodTypeAny {
  // Well-known types (Struct/Value/Timestamp/...) are free-form or have bespoke
  // JSON encodings; the walker treats them as opaque rather than recursing.
  if (desc.typeName.startsWith("google.protobuf.")) return z.any();
  return buildMessage(desc, cache);
}

function fieldToZod(field: DescField, cache: Map<string, z.ZodTypeAny>): z.ZodTypeAny {
  switch (field.fieldKind) {
    case "scalar":
      return scalarToZod(field.scalar);
    case "enum":
      return z.number();
    case "message":
      return messageRef(field.message, cache);
    case "list":
      return z.array(
        field.listKind === "scalar"
          ? scalarToZod(field.scalar)
          : field.listKind === "enum"
            ? z.number()
            : messageRef(field.message, cache),
      );
    case "map":
      return z.record(
        field.mapKind === "scalar"
          ? scalarToZod(field.scalar)
          : field.mapKind === "enum"
            ? z.number()
            : messageRef(field.message, cache),
      );
  }
}

/**
 * Build a Zod schema for a message descriptor. The schema is registered in the
 * cache BEFORE its fields are walked and is wrapped in z.lazy, so a field that
 * references the same message (directly or transitively) reuses the identical
 * node — which terminates recursion and lets zod-to-json-schema emit a $ref.
 */
function buildMessage(desc: DescMessage, cache: Map<string, z.ZodTypeAny>): z.ZodTypeAny {
  const cached = cache.get(desc.typeName);
  if (cached) return cached;

  const lazy: z.ZodTypeAny = z.lazy(() => {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const field of desc.fields) {
      shape[field.localName] = fieldToZod(field, cache).optional();
    }
    return z.object(shape);
  });

  cache.set(desc.typeName, lazy);
  return lazy;
}

function descToZod(desc: DescMessage): z.ZodTypeAny {
  return buildMessage(desc, new Map());
}

// A workflow task whose recursion is exercised two ways:
//  - typed:   compensate[].compensate[]  (the proto cycle jsonschema-go chokes on)
//  - untyped: task_config.branches[].do[] (fork nesting lives in the Struct)
const nestedTask = {
  name: "create_order",
  kind: WorkflowTaskKind.http_call,
  taskConfig: {
    branches: [{ name: "b1", do: [{ name: "inner_fork_task", kind: "http_call" }] }],
  },
  compensate: [
    {
      name: "cancel_order",
      kind: WorkflowTaskKind.http_call,
      taskConfig: { method: "DELETE" },
      compensate: [{ name: "deep_compensate", kind: WorkflowTaskKind.http_call, compensate: [] }],
    },
  ],
} satisfies Partial<WorkflowTask> & Record<string, unknown>;

describe("Spike B: recursive apply-input schema", () => {
  it("protobuf-es round-trips the recursive WorkflowTask natively", () => {
    const msg = create(WorkflowTaskSchema, nestedTask);
    const json = toJson(WorkflowTaskSchema, msg, { useProtoFieldName: true }) as Record<
      string,
      any
    >;

    // Typed recursion (compensate → WorkflowTask) survives serialization.
    expect(json.compensate[0].compensate[0].name).toBe("deep_compensate");
    // Untyped fork nesting inside the task_config Struct survives too.
    expect(json.task_config.branches[0].do[0].name).toBe("inner_fork_task");
  });

  it("a descriptor-derived recursive Zod schema validates and round-trips via create()", () => {
    const schema = descToZod(WorkflowTaskSchema);

    const parsed = schema.parse(nestedTask);
    const msg = create(WorkflowTaskSchema, parsed as Partial<WorkflowTask>);
    const json = toJson(WorkflowTaskSchema, msg, { useProtoFieldName: true }) as Record<
      string,
      any
    >;

    expect(json.compensate[0].compensate[0].name).toBe("deep_compensate");
  });

  it("registerTool accepts the recursive schema and discovery exposes it with $ref", async () => {
    const server = new McpServer({ name: "spike-b", version: "test" });
    server.registerTool(
      "apply_workflow_spike",
      {
        description: "Spike: create or update a workflow (recursive WorkflowTask input).",
        inputSchema: { task: descToZod(WorkflowTaskSchema) },
      },
      () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "spike-b-client", version: "test" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "apply_workflow_spike");

      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties?.task).toBeDefined();
      // Recursion is expressed by reference — the exact capability jsonschema-go lacked.
      expect(JSON.stringify(tool?.inputSchema)).toContain("$ref");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
