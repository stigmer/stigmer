/**
 * Pins the mock endpoint's last resort (`mock-endpoint.ts` `serve`): a
 * request the MCP transport fails on is logged and answered 500, so a
 * stand-in's failure is the engine's tool error and never the runner's
 * crash. The transport is faked here; the endpoint's real paths are pinned
 * in `mock-endpoint.test.ts`.
 */

import { create } from "@bufbuild/protobuf";
import {
  PluginEvalCaseContextSchema,
  PluginEvalMockKind,
  PluginEvalMockServerSchema,
  PluginEvalMockToolSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/plugin_eval_case_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { caseArchiveOf } from "../case-archive.js";

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: class {
    start(): Promise<void> {
      return Promise.resolve();
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
    send(): Promise<void> {
      return Promise.resolve();
    }
    handleRequest(): Promise<void> {
      return Promise.reject(new Error("transport broke"));
    }
  },
}));

const { startMockEndpoint } = await import("../mock-endpoint.js");

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
  vi.restoreAllMocks();
});

describe("the mock endpoint's failed request", () => {
  it("is logged and answered 500", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const context = create(PluginEvalCaseContextSchema, {
      pluginId: "plg_1",
      mocks: [
        create(PluginEvalMockServerSchema, {
          server: "tracker",
          segment: "plugin_kit_tracker",
          tools: [create(PluginEvalMockToolSchema, { tool: "create_issue", file: "evals/mocks/tracker/create_issue.md", kind: PluginEvalMockKind.fixed })],
        }),
      ],
    });
    const endpoint = await startMockEndpoint({ context, archive: caseArchiveOf([]), agentModel: () => Promise.reject(new Error("unused")) });
    close = endpoint?.close;
    const server = endpoint?.servers[0];
    const response = await fetch(server?.url ?? "", { method: "POST", body: "{}", headers: { ...server?.headers, "content-type": "application/json" } });
    expect(response.status).toBe(500);
    expect(warn).toHaveBeenCalledWith("[plugin-eval mocks] request failed: transport broke");
  });
});
