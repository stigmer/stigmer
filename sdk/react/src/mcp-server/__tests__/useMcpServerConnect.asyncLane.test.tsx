// Pins the connect hook's ride on the async connect lane (stigmer#425):
// startConnect + poll on a backend that serves it, and the blocking-RPC
// fallback on one that does not (the byoaEditionDegradation idiom — every
// OTHER mcp-server test in this suite exercises the fallback implicitly, this
// file pins BOTH lanes explicitly so neither can regress silently). The
// protocol's own edge cases (deadlines, rehydration codes) are pinned in
// @stigmer/sdk's mcpserver-connect.test.ts — this is the hook-level contract.

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectPhase } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { StigmerContext } from "../../context";
import { useMcpServerConnect } from "../useMcpServerConnect";

afterEach(cleanup);

const SERVER_ID = "mcps_01test";
const ORG = "acme";

function mcpServer(phase: ConnectPhase, extras?: { failureMessage?: string; toolName?: string }) {
  return create(McpServerSchema, {
    metadata: { id: SERVER_ID, name: "Test Server" },
    status: {
      ...(extras?.toolName !== undefined
        ? { discoveredCapabilities: { tools: [{ name: extras.toolName }] } }
        : {}),
      connectStatus: {
        phase,
        workflowId: `stigmer/mcp-server/connect/${SERVER_ID}`,
        failureCode: extras?.failureMessage !== undefined ? "FailedPrecondition" : "",
        failureMessage: extras?.failureMessage ?? "",
      },
    },
  });
}

function renderConnectHook(register: Parameters<typeof createRouterTransport>[0]) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport(register),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return renderHook(() => useMcpServerConnect(), { wrapper });
}

describe("useMcpServerConnect — async lane", () => {
  it("resolves through startConnect + polling when the backend serves the lane", async () => {
    let blockingConnectCalled = false;
    const { result } = renderConnectHook((router) => {
      router.service(McpServerCommandController, {
        startConnect: () => mcpServer(ConnectPhase.connecting),
        connect: () => {
          blockingConnectCalled = true;
          return mcpServer(ConnectPhase.succeeded);
        },
      });
      router.service(McpServerQueryController, {
        get: () => mcpServer(ConnectPhase.succeeded, { toolName: "search_code" }),
      });
    });

    await act(async () => {
      const settled = await result.current.connect(SERVER_ID, ORG);
      expect(settled.status?.discoveredCapabilities?.tools[0]?.name).toBe("search_code");
    });
    expect(blockingConnectCalled).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isConnecting).toBe(false);
  }, 15_000);

  it("surfaces a failed operation with the persisted user-facing message", async () => {
    const { result } = renderConnectHook((router) => {
      router.service(McpServerCommandController, {
        startConnect: () => mcpServer(ConnectPhase.connecting),
      });
      router.service(McpServerQueryController, {
        get: () =>
          mcpServer(ConnectPhase.failed, {
            failureMessage: "connect failed for MCP server 'Test Server': missing credentials",
          }),
      });
    });

    await act(async () => {
      await expect(result.current.connect(SERVER_ID, ORG)).rejects.toThrow("missing credentials");
    });
    expect(result.current.error?.message).toContain("missing credentials");
    expect(result.current.isConnecting).toBe(false);
  }, 15_000);

  it("falls back to the blocking connect on a backend without the lane", async () => {
    // startConnect deliberately unregistered: the router answers
    // UNIMPLEMENTED, exactly what a pre-#425 backend (e.g. the hosted
    // edition until its parity lands) returns.
    const { result } = renderConnectHook((router) => {
      router.service(McpServerCommandController, {
        connect: () => mcpServer(ConnectPhase.succeeded, { toolName: "search_code" }),
      });
    });

    await act(async () => {
      const settled = await result.current.connect(SERVER_ID, ORG);
      expect(settled.status?.discoveredCapabilities?.tools[0]?.name).toBe("search_code");
    });
    expect(result.current.error).toBeNull();
  });
});
