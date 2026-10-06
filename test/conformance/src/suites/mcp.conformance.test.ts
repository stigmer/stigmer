// Conformance suite for the TypeScript MCP server (@stigmer/mcp-server).
// Domain: MCP protocol bridge over a live backend (the OSS server or the
// cloud Java service).
//
// Unlike the other suites — which drive the raw proto controllers via a
// TargetProfile — this one exercises the MCP tool surface end-to-end through
// an in-memory MCP client, and once more over Streamable HTTP through the
// stateless handler a host mounts (createMcpHttpHandler), where every request
// carries its own bearer and builds its own server. It proves the full path: MCP tool input -> codegen
// apply projection (toProto) -> gRPC Apply on the real server -> protojson
// back through the read tool. A small backend resolver (not a TargetProfile)
// is used because the MCP server exposes tools, not proto clients — but it
// still keys off CONFORMANCE_TARGET so the same assertions pin both editions:
//   - local (default): boots the OSS server, unauthenticated (apiKey "").
//   - cloud: connects to the CLOUD_ENV-provisioned environment as the primary
//     conformance user; the bridge's startup apiKey carries the user's JWT
//     (BackendTarget.apiKey is the stdio credential resolveToken falls back
//     to), so every tool call traverses real auth + FGA.
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createClient } from "@connectrpc/connect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpHttpHandler, createServer } from "@stigmer/mcp-server";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLOUD_ENV } from "../harness/cloud-env";
import { createTransport } from "../harness/clients";
import { spawnServer } from "@stigmer/test-support/server-process";
import { ensureLibraryServerEntry } from "@stigmer/test-support/ts-build";
import { uniqueName } from "../support/naming";

// What the bridge and the suite need from either edition: gRPC coordinates,
// the startup credential, one org to work in, and a teardown for whatever the
// resolver itself booted (nothing, for the pre-provisioned cloud env).
interface BridgeBackend {
  serverAddress: string;
  apiKey: string;
  orgSlug: string;
  // The org's id, which every resource it owns names: tools name the org by
  // slug, and the server answers with the id.
  orgId: string;
  stop(): Promise<void>;
}

let backend: BridgeBackend;
let mcpClient: Client;
let orgSlug: string;
let orgId: string;

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await mcpClient.callTool({ name, arguments: args })) as ToolResult;
}

// Boots the OSS server (a node entry, the LocalTarget launch shape) and
// creates the working org tokenless (single-tenant, no auth). The org create
// doubles as the gRPC-readiness gate.
async function resolveLocalBackend(): Promise<BridgeBackend> {
  const entry = await ensureLibraryServerEntry();
  const server = await spawnServer(process.execPath, { args: [entry] });
  const orgCommand = createClient(OrganizationCommandController, createTransport(server.baseUrl));

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
    await server.stop();
    throw new Error(`server not ready: ${String(lastErr)}\n${server.logTail()}`);
  }
  return {
    serverAddress: `127.0.0.1:${server.port}`,
    apiKey: "",
    orgSlug: created.metadata!.slug,
    orgId: created.metadata!.id,
    stop: () => server.stop(),
  };
}

// Connects to the provisioned cloud environment (the cloud global setup's
// CLOUD_ENV contract) and creates the working org as the primary conformance
// user via the production RPC — the same tenancy shape CloudTarget provisions.
async function resolveCloudBackend(): Promise<BridgeBackend> {
  const baseUrl = requireEnv(CLOUD_ENV.address);
  const token = requireEnv(CLOUD_ENV.token);
  const orgCommand = createClient(
    OrganizationCommandController,
    createTransport(baseUrl, { bearerToken: token }),
  );
  const created = await orgCommand.create({
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: uniqueName("mcp-conf-org") },
  });
  return {
    serverAddress: baseUrl.replace(/^https?:\/\//, ""),
    apiKey: token,
    orgSlug: created.metadata!.slug,
    orgId: created.metadata!.id,
    // The org is this suite's only footprint; the environment belongs to the
    // global setup.
    stop: async () => {
      await orgCommand.delete({ value: created.metadata!.id });
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set: the cloud bridge run expects a provisioned environment ` +
        "(run via `npm run test:cloud`, or set the CLOUD_ENV variables).",
    );
  }
  return value;
}

beforeAll(async () => {
  backend =
    process.env.CONFORMANCE_TARGET === "cloud"
      ? await resolveCloudBackend()
      : await resolveLocalBackend();
  orgSlug = backend.orgSlug;
  orgId = backend.orgId;

  const mcp = createServer({ serverAddress: backend.serverAddress, apiKey: backend.apiKey });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  mcpClient = new Client({ name: "mcp-conformance", version: "test" });
  await Promise.all([mcp.connect(serverTransport), mcpClient.connect(clientTransport)]);
}, 60_000);

afterAll(async () => {
  await mcpClient?.close();
  await backend?.stop();
});

describe("MCP server conformance (live backend)", () => {
  it("advertises the full tool roster", async () => {
    const { tools } = await mcpClient.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "search",
        "get_agent",
        "apply_agent",
        "delete_agent",
        "apply_mcp_server",
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
    expect(applied.metadata?.org, "named by slug, filed under the id").toBe(orgId);
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

describe("MCP server conformance over Streamable HTTP (stateless handler)", () => {
  let host: Server;
  let httpClient: Client;
  let httpTransport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    // The handler as a host mounts it: no startup credential, so every tool
    // call runs on the bearer its own request carried.
    const handler = createMcpHttpHandler({
      target: { serverAddress: backend.serverAddress, apiKey: "" },
      authRequired: backend.apiKey !== "",
      oauth: { enabled: false, resource: "", authorizationServers: [], scopesSupported: [] },
    });
    host = createHttpServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
    const port = (host.address() as AddressInfo).port;
    httpTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`), {
      requestInit: backend.apiKey === "" ? undefined : { headers: { Authorization: `Bearer ${backend.apiKey}` } },
    });
    httpClient = new Client({ name: "mcp-conformance-http", version: "test" });
    await httpClient.connect(httpTransport);
  });

  afterAll(async () => {
    await httpClient?.close();
    await new Promise<void>((resolve) => (host ? host.close(() => resolve()) : resolve()));
  });

  it("applies and reads back an agent with no MCP session", async () => {
    const slug = uniqueName("http-agent");
    const applied = (await httpClient.callTool({
      name: "apply_agent",
      arguments: { name: slug, org: orgSlug, instructions: "Served over the stateless handler." },
    })) as ToolResult;
    expect(applied.isError, applied.content[0]?.text).toBeFalsy();

    const fetched = (await httpClient.callTool({ name: "get_agent", arguments: { org: orgSlug, slug } })) as ToolResult;
    expect(fetched.isError, fetched.content[0]?.text).toBeFalsy();
    expect(JSON.parse(fetched.content[0]?.text ?? "{}").spec?.instructions).toBe("Served over the stateless handler.");
    expect(httpTransport.sessionId, "the server never issues a session").toBeUndefined();
  });
});
