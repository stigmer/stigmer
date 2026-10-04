// Unit arms for two support seams.
// - The submit-approval seam: one submit, then the response's
//   pending_approvals must equal what the decision leaves behind — a match
//   returns the response, a mismatch is red under the caller's label, and in
//   neither case is the decision submitted twice.
// - createConnectedMcpServer: it registers the fixture surface it was given,
//   connects, and returns the connected server only when the connect
//   succeeded and the stored destructive_hint marks exactly the fixture's
//   destructive tool; anything else is red at the helper, naming the cause,
//   and the server's delete is deferred either way.
// Pure: hand-built resources and stubbed clients, no target.
// Domain: conformance support (execution engine).
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { type McpServer, McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectPhase } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { FixtureTracker } from "../../harness/fixtures";
import { DESTRUCTIVE_ECHO_TOOL_NAME, ECHO_TOOL_NAME, type McpToolFixture } from "../../harness/mcp-server";
import { createConnectedMcpServer, submitApprovalPerContract } from "../agentexecutions";

function executionWithPending(toolCallIds: string[]): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id: "aex_unit" },
    status: { pendingApprovals: toolCallIds.map((toolCallId) => ({ toolCallId })) },
  });
}

describe("submitApprovalPerContract", () => {
  it("submits once and returns the response when pending_approvals matches the decision", async () => {
    const settled = executionWithPending([]);
    const submit = vi.fn(async () => settled);
    const response = await submitApprovalPerContract({
      submit,
      expectedRemaining: 0,
      label: "approve clears the gate",
    });
    expect(response).toBe(settled);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("accepts a partially resolved gate when the decision leaves that many pending", async () => {
    const oneLeft = executionWithPending(["call_second"]);
    const response = await submitApprovalPerContract({
      submit: async () => oneLeft,
      expectedRemaining: 1,
      label: "one gate remains after the first approve",
    });
    expect(response).toBe(oneLeft);
  });

  it("is red under the caller's label when the response still lists the decided call — and never re-submits", async () => {
    const submit = vi.fn(async () => executionWithPending(["call_a"]));
    await expect(
      submitApprovalPerContract({
        submit,
        expectedRemaining: 0,
        label: "approve clears the gate",
      }),
    ).rejects.toThrow("approve clears the gate");
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

// A server as connect answers it: the phase, a failure message, and the
// stored hint per discovered tool.
function connectedServer(phase: ConnectPhase, hints: Record<string, boolean>, failureMessage = ""): McpServer {
  return create(McpServerSchema, {
    metadata: { id: "mcp_unit", slug: "mcp-unit" },
    status: {
      connectStatus: { phase, failureMessage },
      discoveredCapabilities: {
        tools: Object.entries(hints).map(([name, destructiveHint]) => ({ name, destructiveHint })),
      },
    },
  });
}

// Stubbed clients and fixture: create answers the bare resource, connect
// answers `connected`, and every call is recorded.
function stubs(connected: McpServer) {
  const createServer = vi.fn(async () => create(McpServerSchema, { metadata: { id: "mcp_unit", slug: "mcp-unit" } }));
  const connect = vi.fn(async () => connected);
  const deleteServer = vi.fn(async () => connected);
  const clients = {
    mcpServerCommand: { create: createServer, connect, delete: deleteServer },
  } as unknown as ConformanceClients;
  const url = vi.fn((tools?: readonly string[]) => `http://127.0.0.1:1/mcp/${(tools ?? []).join(",")}`);
  const mcp = { url } as unknown as McpToolFixture;
  return { clients, mcp, createServer, connect, deleteServer, url };
}

describe("createConnectedMcpServer", () => {
  const tools = [ECHO_TOOL_NAME, DESTRUCTIVE_ECHO_TOOL_NAME] as const;

  it("registers the given surface, connects it, and returns the connected server when the hints match", async () => {
    const connected = connectedServer(ConnectPhase.succeeded, { [ECHO_TOOL_NAME]: false, [DESTRUCTIVE_ECHO_TOOL_NAME]: true });
    const s = stubs(connected);
    const fixtures = new FixtureTracker();

    const result = await createConnectedMcpServer(s.clients, s.mcp, fixtures, { org: "org-unit", name: "mcp-unit", tools: [...tools] });

    expect(result).toBe(connected);
    expect(s.url).toHaveBeenCalledWith([...tools]);
    expect(s.connect).toHaveBeenCalledWith({ mcpServerId: "mcp_unit", org: "org-unit" });
    await fixtures.cleanup();
    expect(s.deleteServer).toHaveBeenCalledWith({ resourceId: "mcp_unit" });
  });

  it("is red naming the failure when the connect did not succeed, and still defers the delete", async () => {
    const s = stubs(connectedServer(ConnectPhase.failed, {}, "fixture unreachable"));
    const fixtures = new FixtureTracker();

    await expect(
      createConnectedMcpServer(s.clients, s.mcp, fixtures, { org: "org-unit", name: "mcp-unit", tools: [...tools] }),
    ).rejects.toThrow("fixture unreachable");
    await fixtures.cleanup();
    expect(s.deleteServer).toHaveBeenCalledTimes(1);
  });

  it("is red when the stored hints do not mark exactly the destructive tool", async () => {
    const s = stubs(connectedServer(ConnectPhase.succeeded, { [ECHO_TOOL_NAME]: false, [DESTRUCTIVE_ECHO_TOOL_NAME]: false }));

    await expect(
      createConnectedMcpServer(s.clients, s.mcp, new FixtureTracker(), { org: "org-unit", name: "mcp-unit", tools: [...tools] }),
    ).rejects.toThrow("the stored discovery marks exactly the fixture's destructive tool");
  });
});
