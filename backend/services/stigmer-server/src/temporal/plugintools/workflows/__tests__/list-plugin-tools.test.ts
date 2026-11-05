/**
 * Pins the tools listing's workflow (workflows/list-plugin-tools.ts), run
 * in-process with the workflow APIs mocked: it schedules the listing
 * activity once on the queue its placement names, passes the plugin, the
 * server's name, the attempt and its token through (absent becomes null),
 * and returns the wire shape the domain reads: each tool's name,
 * description and `destructiveHint`, nothing else. A placement on a
 * session's queue, or none, is refused non-retryably before anything is
 * scheduled. The session prefix is the sandbox naming table's.
 */
import { ApplicationFailure } from "@temporalio/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SANDBOX_QUEUE_PREFIXES } from "../../../../sandbox/naming.js";
import {
  LISTING_ON_SESSION_QUEUE_FAILURE_TYPE,
  SESSION_QUEUE_PREFIX,
  listPluginTools,
} from "../list-plugin-tools.js";

const temporal = vi.hoisted(() => ({
  activity: vi.fn<(input: unknown) => Promise<{ tools: Record<string, unknown>[] }>>(),
  options: [] as unknown[],
}));

vi.mock("@temporalio/workflow", async () => {
  const { ApplicationFailure: Failure } = await import("@temporalio/common");
  return {
    ApplicationFailure: Failure,
    proxyActivities: vi.fn((options: unknown) => {
      temporal.options.push(options);
      return { DiscoverMcpServerCapabilities: temporal.activity };
    }),
  };
});

beforeEach(() => {
  temporal.activity.mockReset();
  temporal.options = [];
});

async function refusalOf(run: Promise<unknown>): Promise<ApplicationFailure> {
  const error = await run.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ApplicationFailure);
  return error as ApplicationFailure;
}

describe("the stigmer/mcp-server/connect workflow", () => {
  it("runs the listing once on the placement's queue and returns each tool's three fields only", async () => {
    temporal.activity.mockResolvedValue({
      tools: [
        { name: "search", description: "Search code", destructiveHint: false },
        { name: "delete_repo", description: "Delete a repo", destructiveHint: true, inputSchema: {} },
        {},
      ],
    });
    const result = await listPluginTools(
      { plugin_id: "plg-1", server: "github", execution_context_id: "att-1", execution_context_token: "tok" },
      { activity_task_queue: "mcpconnect:connect-plg-1-0a1b2c3d" },
    );
    expect(temporal.activity).toHaveBeenCalledTimes(1);
    expect(temporal.activity).toHaveBeenCalledWith({
      pluginId: "plg-1",
      server: "github",
      executionContextId: "att-1",
      executionContextToken: "tok",
    });
    expect(temporal.options).toEqual([
      expect.objectContaining({ taskQueue: "mcpconnect:connect-plg-1-0a1b2c3d", retry: { maximumAttempts: 1 } }),
    ]);
    expect(result).toEqual({
      tools: [
        { name: "search", description: "Search code", destructiveHint: false },
        { name: "delete_repo", description: "Delete a repo", destructiveHint: true },
        { name: "", description: "", destructiveHint: false },
      ],
    });
  });

  it("passes an absent attempt and token as null", async () => {
    temporal.activity.mockResolvedValue({ tools: [] });
    await listPluginTools({ plugin_id: "plg-1", server: "github" }, { activity_task_queue: "stigmer_runner" });
    expect(temporal.activity).toHaveBeenCalledWith({
      pluginId: "plg-1",
      server: "github",
      executionContextId: null,
      executionContextToken: null,
    });
  });

  it("refuses a session's queue, non-retryably, and schedules nothing", async () => {
    const refusal = await refusalOf(
      listPluginTools({ plugin_id: "plg-1", server: "github" }, { activity_task_queue: "session:ses_01" }),
    );
    expect(refusal.type).toBe(LISTING_ON_SESSION_QUEUE_FAILURE_TYPE);
    expect(refusal.nonRetryable).toBe(true);
    expect(temporal.activity).not.toHaveBeenCalled();
  });

  it("refuses a start without a placement", async () => {
    const refusal = await refusalOf(listPluginTools({ plugin_id: "plg-1", server: "github" }, undefined));
    expect(refusal.nonRetryable).toBe(true);
    expect(temporal.activity).not.toHaveBeenCalled();
  });

  it("names a session's queue with the sandbox naming table's prefix", () => {
    expect(SESSION_QUEUE_PREFIX).toBe(SANDBOX_QUEUE_PREFIXES.session);
  });
});
