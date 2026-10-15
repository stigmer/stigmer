/**
 * Pins the eval-case mock endpoint (`mock-endpoint.ts`) through a real
 * MCP client over loopback: each stand-in lists only its mocked tools, with
 * the saved schema where there is one; a fixed mock renders its body and
 * fixtures (the case's before the suite's); an error mock answers as a tool
 * error; a violated `expect:` stops the try with the guard's sentence; an
 * agent mock answers through the model, reports its cost, keeps the
 * server's history, ends the run when the model does, and stops the try
 * past the shared budget; a call without the token is refused, and so is a
 * path naming no stand-in; a case with no mocks starts no endpoint; an
 * unmocked tool, a call before the turn binds the endpoint and a fixture the
 * archive lacks answer as tool errors.
 */

import { afterEach, describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  EvalCaseContextSchema,
  EvalMockKind,
  EvalMockServerSchema,
  EvalMockToolSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/eval_case_pb";

import type { MockAbort } from "../../../harness/stop-controller.js";
import type { AgentMockModel, AgentMockRequest } from "../agent-mock.js";
import { caseArchiveOf } from "../case-archive.js";
import { type MockEndpoint, startMockEndpoint } from "../mock-endpoint.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const ARCHIVE = caseArchiveOf([
  { path: "evals/mocks/tracker/create_issue.md", content: encode("---\nexpect:\n  title: string\n---\nCreated #4821: {{input.title}}") },
  { path: "evals/mocks/tracker/close_issue.md", content: encode("---\nerror: true\n---\nNo such issue.") },
  { path: "evals/mocks/tracker/_tools.json", content: encode(JSON.stringify({ tools: [{ name: "create_issue", description: "Create one", inputSchema: { type: "object", properties: { title: { type: "string" } } } }] })) },
  { path: "evals/mocks/orders/lookup_order.md", content: encode("{{file:fixtures/{input.id}.json}}") },
  { path: "evals/mocks/orders/fixtures/7.json", content: encode('{"from":"suite"}') },
  { path: "evals/fix/mocks/orders/fixtures/7.json", content: encode('{"from":"case"}') },
  { path: "evals/mocks/orders/_server.md", content: encode("---\ntype: agent\ntools: [refund]\n---\nYou refund orders.") },
  { path: "evals/mocks/orders/receipt.md", content: encode("{{file:fixtures/missing.json}}") },
]);

const tool = (fields: { tool: string; file: string; kind: EvalMockKind; error?: boolean; expectJson?: string; abortWhen?: string }) =>
  create(EvalMockToolSchema, fields);

function contextOf(budget: number) {
  return create(EvalCaseContextSchema, {
    pluginId: "plg_1",
    pluginName: "kit",
    pluginDigest: "a".repeat(64),
    suiteDir: "evals",
    caseDir: "evals/fix",
    agentMockCallBudget: budget,
    mocks: [
      create(EvalMockServerSchema, {
        server: "tracker",
        segment: "plugin_kit_tracker",
        toolsFile: "evals/mocks/tracker/_tools.json",
        tools: [
          tool({ tool: "close_issue", file: "evals/mocks/tracker/close_issue.md", kind: EvalMockKind.fixed, error: true }),
          tool({ tool: "create_issue", file: "evals/mocks/tracker/create_issue.md", kind: EvalMockKind.fixed, expectJson: '{"title":"string"}' }),
        ],
      }),
      create(EvalMockServerSchema, {
        server: "orders",
        segment: "plugin_kit_orders",
        tools: [
          tool({ tool: "lookup_order", file: "evals/mocks/orders/lookup_order.md", kind: EvalMockKind.fixed }),
          tool({ tool: "receipt", file: "evals/mocks/orders/receipt.md", kind: EvalMockKind.fixed }),
          tool({ tool: "refund", file: "evals/mocks/orders/_server.md", kind: EvalMockKind.agent, abortWhen: "the order is unknown" }),
        ],
      }),
    ],
  });
}

let endpoint: MockEndpoint | undefined;
afterEach(async () => {
  await endpoint?.close();
  endpoint = undefined;
});

async function started(budget: number, agentModel: AgentMockModel) {
  const aborts: MockAbort[] = [];
  const costs: number[] = [];
  endpoint = await startMockEndpoint({ context: contextOf(budget), archive: ARCHIVE, agentModel });
  if (endpoint === undefined) throw new Error("expected an endpoint");
  endpoint.bind({ onAbort: (abort) => aborts.push(abort), onCost: (cost) => costs.push(cost) });
  const connect = async (segment: string): Promise<Client> => {
    const server = endpoint?.servers.find((s) => s.slug === segment);
    if (server?.url === undefined) throw new Error(`no stand-in ${segment}`);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
    return client;
  };
  return { aborts, costs, connect };
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>): string =>
  (result.content as { type: string; text: string }[]).map((part) => part.text).join("");

const noModel: AgentMockModel = () => Promise.reject(new Error("no model in this test"));

describe("the mock endpoint", () => {
  it("registers each stand-in under the plugin server's own name, for its mocked tools only", async () => {
    const { connect } = await started(4, noModel);
    expect(endpoint?.servers.map((s) => [s.slug, s.home])).toEqual([
      ["plugin_kit_tracker", { kind: "plugin", pluginId: "plg_1", plugin: "kit", server: "tracker" }],
      ["plugin_kit_orders", { kind: "plugin", pluginId: "plg_1", plugin: "kit", server: "orders" }],
    ]);
    expect(endpoint?.listed).toEqual([
      { server: "plugin_kit_tracker", tools: ["close_issue", "create_issue"] },
      { server: "plugin_kit_orders", tools: ["lookup_order", "receipt", "refund"] },
    ]);
    const tracker = await connect("plugin_kit_tracker");
    const { tools } = await tracker.listTools();
    expect(tools.map((t) => [t.name, t.description, t.inputSchema])).toEqual([
      ["close_issue", "The close_issue tool of tracker.", { type: "object", additionalProperties: true }],
      ["create_issue", "Create one", { type: "object", properties: { title: { type: "string" } } }],
    ]);
    await tracker.close();
  });

  it("answers fixed mocks with their rendered body, fixtures and tool errors", async () => {
    const { connect, aborts } = await started(4, noModel);
    const tracker = await connect("plugin_kit_tracker");
    expect(text(await tracker.callTool({ name: "create_issue", arguments: { title: "Crash" } }))).toBe("Created #4821: Crash");
    const closed = await tracker.callTool({ name: "close_issue", arguments: {} });
    expect([closed.isError, text(closed)]).toEqual([true, "No such issue."]);
    const orders = await connect("plugin_kit_orders");
    expect(text(await orders.callTool({ name: "lookup_order", arguments: { id: "7" } }))).toBe('{"from":"case"}');
    expect(aborts).toEqual([]);
    await tracker.close();
    await orders.close();
  });

  it("stops the try when a call breaks the mock's guard", async () => {
    const { connect, aborts } = await started(4, noModel);
    const tracker = await connect("plugin_kit_tracker");
    const result = await tracker.callTool({ name: "create_issue", arguments: { title: 7 } });
    expect(text(result)).toBe("This call stopped the test: input.title must be a string");
    expect(aborts).toEqual([{ server: "tracker", tool: "create_issue", reason: "input.title must be a string" }]);
    await tracker.close();
  });

  it("answers agent mocks through the model, with the server's history, cost, abort and budget", async () => {
    const asked: AgentMockRequest[] = [];
    const model: AgentMockModel = (request) => {
      asked.push(request);
      const input = request.input as { id?: string };
      return Promise.resolve(
        input.id === "unknown"
          ? { kind: "abort", reason: "order unknown", costUsd: 0.01 }
          : { kind: "answer", text: `Refunded ${input.id ?? ""}`, costUsd: 0.02 },
      );
    };
    const { connect, aborts, costs } = await started(2, model);
    const orders = await connect("plugin_kit_orders");
    expect(text(await orders.callTool({ name: "refund", arguments: { id: "1" } }))).toBe("Refunded 1");
    await orders.callTool({ name: "refund", arguments: { id: "unknown" } });
    await orders.callTool({ name: "refund", arguments: { id: "3" } });
    expect(asked.map((r) => [r.instructions, r.abortWhen, r.history.length])).toEqual([
      ["You refund orders.", "the order is unknown", 0],
      ["You refund orders.", "the order is unknown", 1],
    ]);
    expect(costs).toEqual([0.02, 0.01]);
    expect(aborts).toEqual([
      { server: "orders", tool: "refund", reason: "order unknown" },
      { server: "orders", tool: "refund", reason: "the agent mocks' call budget of 2 calls ran out" },
    ]);
    await orders.close();
  });

  it("refuses a request without the turn's token", async () => {
    await started(4, noModel);
    const url = endpoint?.servers[0]?.url ?? "";
    const response = await fetch(url, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(response.status).toBe(401);
  });

  it("answers 404 for a path that names no stand-in", async () => {
    await started(4, noModel);
    const known = endpoint?.servers[0];
    const url = (known?.url ?? "").replace("plugin_kit_tracker", "plugin_kit_unknown");
    const response = await fetch(url, { method: "POST", body: "{}", headers: { ...known?.headers, "content-type": "application/json" } });
    expect(response.status).toBe(404);
    const root = await fetch(new URL("/", url), { headers: known?.headers });
    expect(root.status).toBe(404);
  });

  it("starts nothing for a case that mocks no server", async () => {
    const context = create(EvalCaseContextSchema, { pluginId: "plg_1" });
    expect(await startMockEndpoint({ context, archive: ARCHIVE, agentModel: noModel })).toBeUndefined();
  });

  it("answers an unmocked tool and a missing fixture as tool errors", async () => {
    const { connect, aborts } = await started(4, noModel);
    const orders = await connect("plugin_kit_orders");
    const unmocked = await orders.callTool({ name: "cancel_order", arguments: {} });
    expect([unmocked.isError, text(unmocked)]).toEqual([true, "the tool 'cancel_order' is not mocked"]);
    const receipt = await orders.callTool({ name: "receipt", arguments: {} });
    expect(receipt.isError).toBe(true);
    expect(text(receipt)).toContain("missing.json");
    expect(aborts).toEqual([]);
    await orders.close();
  });

  it("refuses a call made before the turn binds the endpoint", async () => {
    endpoint = await startMockEndpoint({ context: contextOf(4), archive: ARCHIVE, agentModel: noModel });
    const server = endpoint?.servers.find((s) => s.slug === "plugin_kit_tracker");
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(server?.url ?? ""), { requestInit: { headers: server?.headers } }));
    const early = await client.callTool({ name: "create_issue", arguments: { title: "Crash" } });
    expect([early.isError, text(early)]).toEqual([true, "the mock is not ready"]);
    await client.close();
  });
});
