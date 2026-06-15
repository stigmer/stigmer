// In-process integration test for the workflow query tools: the task-kind
// registry pair (get_task_kind_registry, get_task_kind) and the execution pair
// (get_workflow_execution, get_workflow_execution_events). Verifies registry
// selection (case-insensitive), the required-field and not-found errors, and
// that page_size is forwarded only when set.

import { create, toJson } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  createServer as createHttp2Server,
  type Http2Server,
  type ServerHttp2Session,
} from "node:http2";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import {
  GetTaskKindRegistryResponseSchema,
  TaskKindDescriptorSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/task_kind_descriptor_pb";
import { TaskKindRegistryQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/task_kind_registry_query_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  type GetEventLogRequest,
  GetEventLogResponseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { createServer } from "../../server";

configureLogger({ level: "error", format: "text" });

const registry = create(GetTaskKindRegistryResponseSchema, {
  descriptors: [
    create(TaskKindDescriptorSchema, { kind: WorkflowTaskKind.set_vars }),
    create(TaskKindDescriptorSchema, { kind: WorkflowTaskKind.for_each }),
  ],
});
const execution = create(WorkflowExecutionSchema, { apiVersion: "v1", kind: "workflow_execution" });
const eventLog = create(GetEventLogResponseSchema, {});

let backend: Http2Server;
let client: Client;
let lastExecutionId: string | undefined;
let lastEventReq: GetEventLogRequest | undefined;
const openSessions = new Set<ServerHttp2Session>();

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(TaskKindRegistryQueryController, { getTaskKindRegistry: () => registry });
    router.service(WorkflowExecutionQueryController, {
      get: (req) => {
        lastExecutionId = req.value;
        return execution;
      },
      getEventLog: (req) => {
        lastEventReq = req;
        return eventLog;
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

  const mcp = createServer({ serverAddress: `127.0.0.1:${port}`, apiKey: "" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "workflow-tools-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("workflow query tools integration", () => {
  it("get_task_kind_registry returns the full registry", async () => {
    const result = await callTool("get_task_kind_registry", {});
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(GetTaskKindRegistryResponseSchema, registry, { useProtoFieldName: true }),
    );
  });

  it("get_task_kind selects one descriptor case-insensitively", async () => {
    const result = await callTool("get_task_kind", { kind: "FOR_EACH" });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(TaskKindDescriptorSchema, registry.descriptors[1]!, { useProtoFieldName: true }),
    );
  });

  it("get_task_kind requires a kind", async () => {
    const result = await callTool("get_task_kind", { kind: "" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("kind is required");
  });

  it("get_task_kind reports an unknown kind", async () => {
    const result = await callTool("get_task_kind", { kind: "does_not_exist" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('task kind "does_not_exist" not found in registry');
  });

  it("get_workflow_execution requires an execution_id", async () => {
    const result = await callTool("get_workflow_execution", { execution_id: "" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("execution_id is required");
  });

  it("get_workflow_execution forwards the id and returns the execution", async () => {
    const result = await callTool("get_workflow_execution", { execution_id: "wex_123" });
    expect(result.isError).toBeFalsy();
    expect(lastExecutionId).toBe("wex_123");
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(WorkflowExecutionSchema, execution, { useProtoFieldName: true }),
    );
  });

  it("get_workflow_execution_events forwards page_size only when set", async () => {
    await callTool("get_workflow_execution_events", { execution_id: "wex_123", task_name: "build" });
    expect(lastEventReq?.taskName).toBe("build");
    expect(lastEventReq?.pageSize).toBe(0);

    await callTool("get_workflow_execution_events", { execution_id: "wex_123", page_size: 50 });
    expect(lastEventReq?.pageSize).toBe(50);
  });
});
