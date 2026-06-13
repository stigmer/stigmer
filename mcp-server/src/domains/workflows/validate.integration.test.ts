// In-process integration test for validate_workflow_yaml. Verifies the
// required-yaml and parse errors, that every registry task kind (including
// `eval`, which the Go map omits) is accepted, and that the parsed Workflow is
// forwarded to validateSpec.

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
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ServerlessWorkflowValidationSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import { configureLogger } from "../../logger";
import { createServer } from "../../server";

configureLogger({ level: "error", format: "text" });

const registryKinds = Object.values(WorkflowTaskKind).filter(
  (v): v is string => typeof v === "string" && v !== "workflow_task_kind_unspecified",
);
const validation = create(ServerlessWorkflowValidationSchema, {});

let backend: Http2Server;
let client: Client;
let lastWorkflow: Workflow | undefined;
const openSessions = new Set<ServerHttp2Session>();

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function validate(yaml: string): Promise<ToolResult> {
  return (await client.callTool({ name: "validate_workflow_yaml", arguments: { yaml } })) as ToolResult;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(WorkflowCommandController, {
      validateSpec: (req) => {
        lastWorkflow = req;
        return validation;
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
  client = new Client({ name: "validate-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("validate_workflow_yaml integration", () => {
  it("requires non-empty yaml", async () => {
    const result = await validate("   ");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("yaml is required");
  });

  it("rejects yaml without a spec", async () => {
    const result = await validate(stringifyYaml({ apiVersion: "v1", kind: "workflow" }));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "failed to parse workflow YAML: missing or invalid 'spec' field",
    );
  });

  it("rejects an unknown task kind with its index", async () => {
    const doc = { spec: { tasks: [{ name: "t0", kind: "bogus_kind" }] } };
    const result = await validate(stringifyYaml(doc));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      'failed to parse workflow YAML: unknown task kind "bogus_kind" at tasks[0]',
    );
  });

  it("accepts every registry task kind (including eval) and forwards the workflow", async () => {
    const doc = {
      apiVersion: "v1",
      kind: "workflow",
      metadata: { name: "wf", org: "acme", slug: "wf" },
      spec: { tasks: registryKinds.map((kind, i) => ({ name: `t${i}`, kind })) },
    };
    const result = await validate(stringifyYaml(doc));
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(ServerlessWorkflowValidationSchema, validation, { useProtoFieldName: true }),
    );
    expect(lastWorkflow?.spec?.tasks.length).toBe(registryKinds.length);
    expect(lastWorkflow?.spec?.tasks.some((t) => t.kind === WorkflowTaskKind.eval)).toBe(true);
  });
});
