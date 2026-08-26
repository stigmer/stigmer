// Conformance slice for the TypeScript MCP server (@stigmer/mcp-server).
// Domain: MCP protocol bridge over a live backend (the OSS server or the
// cloud Java service).
//
// Unlike the other suites — which drive the raw proto controllers via a
// TargetProfile — this one exercises the MCP tool surface end-to-end through
// an in-memory MCP client. It proves the full path: MCP tool input -> codegen
// apply projection (toProto) -> gRPC Apply on the real server -> protojson
// back through the read tool. A small backend resolver (not a TargetProfile)
// is used because the MCP server exposes tools, not proto clients — but it
// still keys off CONFORMANCE_TARGET so the same assertions pin both editions:
//   - local (default): boots the OSS server, unauthenticated (apiKey "").
//   - cloud: connects to the CLOUD_ENV-provisioned environment as the primary
//     conformance user; the bridge's startup apiKey carries the user's JWT
//     (BackendTarget.apiKey is the stdio credential resolveToken falls back
//     to), so every tool call traverses real auth + FGA.
import { createClient } from "@connectrpc/connect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "@stigmer/mcp-server";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLOUD_ENV } from "../harness/cloud-env";
import { createTransport } from "../harness/clients";
import { spawnServer } from "../harness/server-process";
import { ensureTsServerEntry } from "../harness/ts-build";
import { uniqueName } from "../support/naming";

// What the bridge and the suite need from either edition: gRPC coordinates,
// the startup credential, one org to work in, and a teardown for whatever the
// resolver itself booted (nothing, for the pre-provisioned cloud env).
interface BridgeBackend {
  serverAddress: string;
  apiKey: string;
  orgSlug: string;
  stop(): Promise<void>;
}

let backend: BridgeBackend;
let mcpClient: Client;
let orgSlug: string;

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
  const entry = await ensureTsServerEntry();
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

  // Round-trip pin for validate_workflow_yaml (stigmer/stigmer#778 finding 2):
  // until 2026-07-28 the MCP client's transport default sent grpc-web to a
  // server path that rejects it, so the ONLY server-backed validation surface
  // died with "Content-Type 'application/grpc-web+proto' is not supported".
  // The roster assertion above never caught that — only a real call does.
  it("validate_workflow_yaml round-trips the real validation pipeline", async () => {
    const workflowYaml = (taskConfig: string) => `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: mcp-validate-roundtrip
  org: ${orgSlug}
spec:
  description: conformance validate_workflow_yaml fixture
  document:
    dsl: "1.0.0"
    namespace: ${orgSlug}
    name: mcp-validate-roundtrip
    version: "1.0.0"
  tasks:
    - name: conditional_wait
      kind: wait
      task_config:
${taskConfig}
`;

    const valid = await callTool("validate_workflow_yaml", {
      yaml: workflowYaml("        duration:\n          seconds: 5"),
    });
    expect(valid.isError, valid.content[0]?.text).toBeFalsy();
    const validVerdict = JSON.parse(valid.content[0]?.text ?? "{}");
    expect(validVerdict.state, JSON.stringify(validVerdict.errors)).toBe("VALID");

    // A config a real apply rejects must come back as a structured INVALID
    // verdict naming the task — never a transport error.
    const invalid = await callTool("validate_workflow_yaml", {
      yaml: workflowYaml('        duration: "5s"'),
    });
    expect(invalid.isError, invalid.content[0]?.text).toBeFalsy();
    const invalidVerdict = JSON.parse(invalid.content[0]?.text ?? "{}");
    expect(invalidVerdict.state).toBe("INVALID");
    expect(JSON.stringify(invalidVerdict.errors)).toContain("conditional_wait");

    // The typed-config CEL contract (stigmer#805): a present-but-all-zero
    // duration parses cleanly (so the structural gate passes) but violates
    // WaitTaskConfig's duration.non_zero message rule — the Layer-2 constraints
    // step must surface it as a structured INVALID verdict.
    const celInvalid = await callTool("validate_workflow_yaml", {
      yaml: workflowYaml("        duration: {}"),
    });
    expect(celInvalid.isError, celInvalid.content[0]?.text).toBeFalsy();
    const celVerdict = JSON.parse(celInvalid.content[0]?.text ?? "{}");
    expect(celVerdict.state).toBe("INVALID");
    expect(JSON.stringify(celVerdict.errors)).toContain(
      "at least one duration field must be non-zero",
    );
  });
});
