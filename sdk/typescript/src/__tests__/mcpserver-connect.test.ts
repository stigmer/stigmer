// Pins the shared async-connect protocol (stigmer/stigmer#425): start + poll,
// terminal-failure rehydration, the UNIMPLEMENTED blocking fallback, and the
// still-running bound. Every SDK surface (CLI, React hooks, host apps) rides
// this one implementation, so its contract is pinned here rather than
// re-tested per consumer.

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ConnectPhase } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { StigmerError, wrapError } from "../gen/errors.js";
import {
  connectAndWait,
  ConnectStillRunningError,
  type McpServerConnectLane,
} from "../mcpserver-connect.js";

const INPUT = create(ConnectInputSchema, { mcpServerId: "mcp-1", org: "test-org" });

function server(overrides?: {
  phase?: ConnectPhase;
  failureCode?: string;
  failureMessage?: string;
  warning?: string;
  toolName?: string;
}): McpServer {
  return create(McpServerSchema, {
    metadata: { id: "mcp-1", name: "Test Server" },
    status: {
      ...(overrides?.toolName !== undefined
        ? { discoveredCapabilities: { tools: [{ name: overrides.toolName }] } }
        : {}),
      connectStatus: {
        phase: overrides?.phase ?? ConnectPhase.connecting,
        workflowId: "stigmer/mcp-server/connect/mcp-1",
        failureCode: overrides?.failureCode ?? "",
        failureMessage: overrides?.failureMessage ?? "",
        warning: overrides?.warning ?? "",
      },
    },
  });
}

function unimplemented(): StigmerError {
  return wrapError(new ConnectError("startConnect is not implemented", Code.Unimplemented));
}

const NEVER = () => new Promise<McpServer>(() => {});

describe("connectAndWait", () => {
  it("resolves with the settled resource once connect_status reports success", async () => {
    const polled = [
      server({ phase: ConnectPhase.connecting }),
      server({ phase: ConnectPhase.succeeded, toolName: "search_code" }),
    ];
    const lane: McpServerConnectLane = {
      startConnect: async () => server(),
      connect: NEVER,
      get: async () => polled.shift() ?? server({ phase: ConnectPhase.succeeded }),
    };

    const settled = await connectAndWait(lane, INPUT, { pollIntervalMs: 1 });
    expect(settled.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
    expect(settled.status?.discoveredCapabilities?.tools[0]?.name).toBe("search_code");
  });

  it("surfaces the CONNECTING snapshot (dead-runner warning) via onStarted", async () => {
    const lane: McpServerConnectLane = {
      startConnect: async () => server({ warning: "no runner appears to be polling the task queue" }),
      connect: NEVER,
      get: async () => server({ phase: ConnectPhase.succeeded }),
    };

    let warning = "";
    await connectAndWait(lane, INPUT, {
      pollIntervalMs: 1,
      onStarted: (started) => {
        warning = started.status?.connectStatus?.warning ?? "";
      },
    });
    expect(warning).toContain("no runner");
  });

  it("rehydrates a failed operation into the classification the blocking RPC would have thrown", async () => {
    const lane: McpServerConnectLane = {
      startConnect: async () => server(),
      connect: NEVER,
      get: async () =>
        server({
          phase: ConnectPhase.failed,
          failureCode: "FailedPrecondition",
          failureMessage: "connect failed for MCP server 'Test Server': missing credentials",
        }),
    };

    const err = await connectAndWait(lane, INPUT, { pollIntervalMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StigmerError);
    const stigmerErr = err as StigmerError;
    // Byte-parity with the blocking lane: same code mapping, same raw message.
    expect(stigmerErr.code).toBe("failed-precondition");
    expect(stigmerErr.message).toBe("connect failed for MCP server 'Test Server': missing credentials");
  });

  it("maps an unknown failure_code to the unknown classification instead of crashing", async () => {
    const lane: McpServerConnectLane = {
      startConnect: async () => server(),
      connect: NEVER,
      get: async () =>
        server({
          phase: ConnectPhase.failed,
          failureCode: "SomeFutureCode",
          failureMessage: "boom",
        }),
    };

    const err = await connectAndWait(lane, INPUT, { pollIntervalMs: 1 }).catch((e: unknown) => e);
    expect((err as StigmerError).code).toBe("unknown");
    expect((err as StigmerError).message).toBe("boom");
  });

  it("falls back to the blocking connect when the backend answers UNIMPLEMENTED", async () => {
    let blockingCalled = false;
    const lane: McpServerConnectLane = {
      startConnect: async () => {
        throw unimplemented();
      },
      connect: async () => {
        blockingCalled = true;
        return server({ phase: ConnectPhase.succeeded, toolName: "search_code" });
      },
      get: NEVER,
    };

    const settled = await connectAndWait(lane, INPUT);
    expect(blockingCalled).toBe(true);
    expect(settled.status?.discoveredCapabilities?.tools[0]?.name).toBe("search_code");
  });

  it("propagates non-UNIMPLEMENTED start failures untouched", async () => {
    const startFailure = wrapError(new ConnectError("no such server", Code.NotFound));
    const lane: McpServerConnectLane = {
      startConnect: async () => {
        throw startFailure;
      },
      connect: NEVER,
      get: NEVER,
    };

    await expect(connectAndWait(lane, INPUT)).rejects.toBe(startFailure);
  });

  it("throws ConnectStillRunningError when the deadline elapses while CONNECTING", async () => {
    const lane: McpServerConnectLane = {
      startConnect: async () => server(),
      connect: NEVER,
      get: async () => server({ phase: ConnectPhase.connecting }),
    };

    const err = await connectAndWait(lane, INPUT, { pollIntervalMs: 1, deadlineMs: 20 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConnectStillRunningError);
    expect((err as ConnectStillRunningError).mcpServerId).toBe("mcp-1");
  });

  it("bounds the blocking fallback with the same still-running semantics (soft, non-cancelling)", async () => {
    const lane: McpServerConnectLane = {
      startConnect: async () => {
        throw unimplemented();
      },
      connect: NEVER,
      get: NEVER,
    };

    const err = await connectAndWait(lane, INPUT, { deadlineMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectStillRunningError);
  });
});
