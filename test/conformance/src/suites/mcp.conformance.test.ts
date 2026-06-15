// Conformance slice for the TypeScript MCP server (@stigmer/mcp-server).
// Domain: MCP protocol bridge over the live OSS Go stigmer-server.
//
// Unlike the other suites — which drive the raw proto controllers via a
// TargetProfile — this one boots the real Go server and exercises the MCP tool
// surface end-to-end through an in-memory MCP client. It proves the full path:
// MCP tool input -> codegen apply projection (toProto) -> gRPC Apply on the real
// server -> protojson back through the read tool. A small helper (not a
// TargetProfile) is used because the MCP server exposes tools, not proto clients.
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "@stigmer/mcp-server";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureServerBinary } from "../harness/go-build";
import { spawnServer, type RunningServer } from "../harness/server-process";
import { uniqueName } from "../support/naming";

let server: RunningServer;
let orgCommand: ReturnType<typeof createClient<typeof OrganizationCommandController>>;
let mcpClient: Client;
let orgSlug: string;

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await mcpClient.callTool({ name, arguments: args })) as ToolResult;
}

beforeAll(async () => {
  const binary = await ensureServerBinary();
  server = await spawnServer(binary);

  const transport = createGrpcTransport({ baseUrl: server.baseUrl });
  orgCommand = createClient(OrganizationCommandController, transport);

  // gRPC-readiness gate: retry org creation until the store is serving.
  const deadline = Date.now() + 15_000;
  let created: Awaited<ReturnType<typeof orgCommand.create>> | undefined;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      created = await orgCommand.create({
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { name: uniqueName("mcp-conf-org") },
      });
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  if (created === undefined) {
    throw new Error(`server not ready: ${String(lastErr)}\n${server.logTail()}`);
  }
  orgSlug = created.metadata!.slug;

  const mcp = createServer({ serverAddress: `127.0.0.1:${server.port}`, apiKey: "" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  mcpClient = new Client({ name: "mcp-conformance", version: "test" });
  await Promise.all([mcp.connect(serverTransport), mcpClient.connect(clientTransport)]);
}, 60_000);

afterAll(async () => {
  await mcpClient?.close();
  await server?.stop();
});

describe("MCP server conformance (live Go server)", () => {
  it("advertises the full tool roster", async () => {
    const { tools } = await mcpClient.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "search",
        "get_agent",
        "apply_agent",
        "delete_agent",
        "apply_mcp_server",
        "apply_workflow",
        "validate_workflow_yaml",
      ]),
    );
  });

  it("apply_agent creates on the real server and get_agent reads it back", async () => {
    const slug = uniqueName("code-reviewer");
    const applyResult = await callTool("apply_agent", {
      name: slug,
      org: orgSlug,
      instructions: "Review code carefully and suggest improvements.",
    });
    expect(applyResult.isError, applyResult.content[0]?.text).toBeFalsy();

    const applied = JSON.parse(applyResult.content[0]?.text ?? "{}");
    expect(applied.metadata?.org).toBe(orgSlug);
    expect(applied.metadata?.slug).toBe(slug);
    expect(applied.spec?.instructions).toBe("Review code carefully and suggest improvements.");

    const getResult = await callTool("get_agent", { org: orgSlug, slug });
    expect(getResult.isError, getResult.content[0]?.text).toBeFalsy();
    const fetched = JSON.parse(getResult.content[0]?.text ?? "{}");
    expect(fetched.metadata?.id).toBe(applied.metadata?.id);
    expect(fetched.spec?.instructions).toBe("Review code carefully and suggest improvements.");
  });

  it("apply_agent then delete_agent removes it", async () => {
    const slug = uniqueName("temp-agent");
    const applyResult = await callTool("apply_agent", {
      name: slug,
      org: orgSlug,
      instructions: "Temporary agent used only to verify deletion.",
    });
    expect(applyResult.isError, applyResult.content[0]?.text).toBeFalsy();

    const deleteResult = await callTool("delete_agent", { org: orgSlug, slug });
    expect(deleteResult.isError, deleteResult.content[0]?.text).toBeFalsy();

    const getResult = await callTool("get_agent", { org: orgSlug, slug });
    expect(getResult.isError).toBe(true); // NotFound surfaces as a tool error
  });
});
