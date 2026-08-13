// In-process integration test for the apply tools. Drives apply_agent,
// apply_mcp_server, apply_workflow, and apply_environment through the
// full MCP boundary and asserts the codegen projection (src/gen/*)
// reconstitutes the proto correctly: metadata hoist + slug generation,
// enum-string conversion,
// ApiResourceReference kind injection, the stdio/http oneof, the environment
// data map with secret flags, and the recursive workflow task_config expansion
// (http_call leaf, fork/for_each nesting).

import { clone } from "@bufbuild/protobuf";
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
import { type Agent, AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import type { McpServer as McpServerProto } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { UpdateVisibilityInput } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../logger";
import { createServer } from "../server";

configureLogger({ level: "error", format: "text" });

let backend: Http2Server;
let client: Client;
let appliedAgent: Agent | undefined;
let appliedMcpServer: McpServerProto | undefined;
let appliedWorkflow: Workflow | undefined;
let appliedEnvironment: Environment | undefined;
const visibilityUpdates: UpdateVisibilityInput[] = [];

// The single-door contract (oss#573): a plain update preserves the STORED
// visibility, so the apply response can disagree with the request. This slug
// makes the mock backend simulate that — apply echoes back a pre-existing
// resource whose stored level is org, regardless of the requested one.
const STORED_ORG_SLUG = "stored-org-agent";
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
    router.service(AgentCommandController, {
      apply: (req) => {
        appliedAgent = req;
        if (req.metadata?.slug === STORED_ORG_SLUG) {
          const stored = clone(AgentSchema, req);
          stored.metadata!.id = "agent-stored-1";
          stored.metadata!.visibility = ApiResourceVisibility.visibility_org;
          return stored;
        }
        return req;
      },
      updateVisibility: (input) => {
        visibilityUpdates.push(input);
        const updated = clone(AgentSchema, appliedAgent!);
        updated.metadata!.id = input.resourceId;
        updated.metadata!.visibility = input.visibility;
        return updated;
      },
    });
    router.service(McpServerCommandController, {
      apply: (req) => {
        appliedMcpServer = req;
        return req;
      },
    });
    router.service(WorkflowCommandController, {
      apply: (req) => {
        appliedWorkflow = req;
        return req;
      },
    });
    router.service(EnvironmentCommandController, {
      apply: (req) => {
        appliedEnvironment = req;
        return req;
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
  client = new Client({ name: "apply-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("apply tools integration", () => {
  it("advertises every apply tool", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "apply_agent",
        "apply_mcp_server",
        "apply_workflow",
        "apply_environment",
      ]),
    );
  });

  it("apply_agent hoists metadata, generates slug, and injects reference kinds", async () => {
    const result = await callTool("apply_agent", {
      name: "Code Reviewer",
      org: "acme",
      visibility: "PUBLIC",
      instructions: "Review code carefully.",
      skill_refs: [{ slug: "web-search", version: "stable" }],
      mcp_server_usages: [{ mcp_server_ref: { slug: "github" }, enabled_tools: ["create_pr"] }],
    });
    expect(result.isError).toBeFalsy();

    const agent = appliedAgent;
    expect(agent?.apiVersion).toBe("agentic.stigmer.ai/v1");
    expect(agent?.kind).toBe("Agent");
    expect(agent?.metadata?.name).toBe("Code Reviewer");
    expect(agent?.metadata?.slug).toBe("code-reviewer"); // auto-generated from name
    expect(agent?.metadata?.org).toBe("acme");
    expect(agent?.metadata?.visibility).toBe(ApiResourceVisibility.visibility_public);
    expect(agent?.spec?.instructions).toBe("Review code carefully.");

    const skillRef = agent?.spec?.skillRefs?.[0];
    expect(skillRef?.slug).toBe("web-search");
    expect(skillRef?.kind).toBe(ApiResourceKind.skill);
    expect(skillRef?.version).toBe("stable"); // version kept for versioned kind

    const usage = agent?.spec?.mcpServerUsages?.[0];
    expect(usage?.mcpServerRef?.slug).toBe("github");
    expect(usage?.mcpServerRef?.kind).toBe(ApiResourceKind.mcp_server);
    expect(usage?.enabledTools).toEqual(["create_pr"]);
  });

  it("apply_mcp_server rebuilds the stdio oneof", async () => {
    const result = await callTool("apply_mcp_server", {
      name: "GitHub",
      org: "acme",
      stdio: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    });
    expect(result.isError).toBeFalsy();
    expect(appliedMcpServer?.spec?.serverType?.case).toBe("stdio");
    expect(appliedMcpServer?.spec?.serverType?.value).toMatchObject({ command: "npx" });
  });

  it("apply_mcp_server rebuilds the http oneof", async () => {
    const result = await callTool("apply_mcp_server", {
      name: "Remote",
      org: "acme",
      http: { url: "https://mcp.example.com/v1" },
    });
    expect(result.isError).toBeFalsy();
    expect(appliedMcpServer?.spec?.serverType?.case).toBe("http");
    expect(appliedMcpServer?.spec?.serverType?.value).toMatchObject({
      url: "https://mcp.example.com/v1",
    });
  });

  it("apply_workflow expands typed task_config and nests recursive tasks", async () => {
    const result = await callTool("apply_workflow", {
      name: "Triage",
      org: "acme",
      document: { namespace: "support", name: "triage", version: "1.0.0" },
      tasks: [
        {
          name: "fetch",
          kind: "http_call",
          http_call: { method: "POST", endpoint: { uri: "https://api.example.com" } },
        },
        {
          name: "parallel",
          kind: "fork",
          fork: {
            branches: [
              {
                name: "b1",
                do: [{ name: "set_x", kind: "set_vars", set_vars: { variables: { x: "1" } } }],
              },
            ],
          },
        },
        {
          name: "loop",
          kind: "for_each",
          for_each: {
            each: "item",
            in: "${ $data.items }",
            do: [
              {
                name: "call",
                kind: "http_call",
                http_call: { method: "GET", endpoint: { uri: "https://api.example.com/item" } },
              },
            ],
          },
        },
      ],
    });
    expect(result.isError).toBeFalsy();

    const wf = appliedWorkflow;
    expect(wf?.apiVersion).toBe("agentic.stigmer.ai/v1");
    expect(wf?.metadata?.slug).toBe("triage");
    expect(wf?.spec?.document?.namespace).toBe("support");

    const tasks = wf?.spec?.tasks ?? [];
    expect(tasks).toHaveLength(3);

    // http_call leaf: task_config Struct carries the serialized config.
    expect(tasks[0]?.kind).toBe(WorkflowTaskKind.http_call);
    expect(tasks[0]?.taskConfig).toMatchObject({ method: "POST" });

    // fork: recursive nesting — branches[].do[] are full tasks.
    expect(tasks[1]?.kind).toBe(WorkflowTaskKind.fork);
    const forkCfg = tasks[1]?.taskConfig as { branches?: Array<{ do?: unknown[] }> };
    expect(forkCfg.branches?.[0]?.do).toHaveLength(1);

    // for_each: recursive nesting via z.lazy.
    expect(tasks[2]?.kind).toBe(WorkflowTaskKind.for_each);
    const forCfg = tasks[2]?.taskConfig as { each?: string; do?: unknown[] };
    expect(forCfg.each).toBe("item");
    expect(forCfg.do).toHaveLength(1);
  });

  it("apply_agent lands a declared visibility the update preserved away via UpdateVisibility (oss#573)", async () => {
    const result = await callTool("apply_agent", {
      name: "Stored Org Agent",
      org: "acme",
      visibility: "PUBLIC",
      instructions: "i",
    });
    expect(result.isError).toBeFalsy();

    // Server "preserved" stored org; the tool must follow up once through
    // the guarded door and return the landed level, not the stale one.
    expect(visibilityUpdates).toHaveLength(1);
    expect(visibilityUpdates[0].resourceId).toBe("agent-stored-1");
    expect(visibilityUpdates[0].visibility).toBe(ApiResourceVisibility.visibility_public);
    const text = result.content.find((c) => c.type === "text")?.text ?? "";
    expect(JSON.parse(text).metadata.visibility).toBe("visibility_public");
  });

  it("apply_agent skips the follow-up when the server already matches", async () => {
    visibilityUpdates.length = 0;
    const result = await callTool("apply_agent", {
      name: "Plain Agent",
      org: "acme",
      visibility: "PUBLIC",
      instructions: "i",
    });
    expect(result.isError).toBeFalsy();
    // The echo backend returns the requested level (and no id) — no diff,
    // no follow-up.
    expect(visibilityUpdates).toHaveLength(0);
  });

  it("apply_environment rebuilds the data map with secret flags", async () => {
    const result = await callTool("apply_environment", {
      name: "GitHub Creds",
      org: "acme",
      data: {
        API_KEY: { value: "sk-real-value", is_secret: true, description: "GitHub PAT" },
        REGION: { value: "us-east-1" },
      },
    });
    expect(result.isError).toBeFalsy();

    const env = appliedEnvironment;
    expect(env?.apiVersion).toBe("agentic.stigmer.ai/v1");
    expect(env?.kind).toBe("Environment");
    expect(env?.metadata?.slug).toBe("github-creds"); // auto-generated from name
    expect(env?.spec?.data?.API_KEY).toMatchObject({
      value: "sk-real-value",
      isSecret: true,
      description: "GitHub PAT",
    });
    expect(env?.spec?.data?.REGION?.isSecret).toBe(false);
  });
});
