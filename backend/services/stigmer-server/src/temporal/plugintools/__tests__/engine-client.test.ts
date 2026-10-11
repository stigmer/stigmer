/**
 * Pins the tools listing's Temporal glue against a fake client:
 *
 *   - startListing starts the runner's connect workflow under the attempt's
 *     own workflow id, with the run timeout and the input as the one
 *     argument, on the shared runner queue or the sandbox's own queue;
 *   - a run's settle is classified into the seam's taxonomy: the output
 *     (an empty one for a null result), the runner's application message
 *     found anywhere in the cause chain and winning over a timeout, a run
 *     timeout, a run Temporal no longer knows, and every other failure by
 *     its own text;
 *   - the race backstop answers Go's "context deadline exceeded" when the
 *     run outlives it, and lets a run that settles first answer;
 *   - the engine-state provider is disconnected until the first connect,
 *     memoized per client and rebuilt on a reconnect.
 */
import type { Client } from "@temporalio/client";
import { WorkflowFailedError, WorkflowNotFoundError } from "@temporalio/client";
import {
  ActivityFailure,
  ApplicationFailure,
  RetryState,
  TimeoutFailure,
  TimeoutType,
} from "@temporalio/common";
import { describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_LOCAL,
  ROUTING_GLOBAL,
} from "../../../domain/run/temporal/config.js";
import type {
  ToolsRunOutcome,
  ToolsTaskQueue,
  ToolsWorkflowInput,
} from "../../../domain/plugin/tools/engine.js";
import type { TemporalManager } from "../../manager.js";
import {
  newPluginToolsEngineStateProvider,
  TemporalPluginToolsEngine,
} from "../engine-client.js";
import { CONNECT_WORKFLOW_NAME } from "../names.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const RUNNER_QUEUE = "agent_execution_runner_queue";

function config(): AgentExecutionTemporalConfig {
  return new AgentExecutionTemporalConfig(
    "agent_execution_stigmer",
    RUNNER_QUEUE,
    ROUTING_GLOBAL,
    DEFAULT_EXECUTION_TARGET_LOCAL,
  );
}

interface StartCall {
  readonly workflowType: string;
  readonly options: Record<string, unknown>;
}

/** A client whose started run settles the way `result` says. */
function stubClient(result: () => Promise<unknown>) {
  const startCalls: StartCall[] = [];
  const client = {
    workflow: {
      start: async (workflowType: string, options: Record<string, unknown>) => {
        startCalls.push({ workflowType, options });
        return { result };
      },
    },
  } as unknown as Client;
  return { client, startCalls };
}

const INPUT: ToolsWorkflowInput = {
  plugin_id: "plg_1",
  server: "orders",
  execution_context_id: "att_1",
};

const RUNNER: ToolsTaskQueue = { kind: "runner" };

async function settle(
  result: () => Promise<unknown>,
  raceTimeoutMs?: number,
): Promise<ToolsRunOutcome> {
  const { client } = stubClient(result);
  const engine = new TemporalPluginToolsEngine({ client, config: config(), logger: silentLogger });
  const run = await engine.startListing("att_1", INPUT, 30_000, RUNNER);
  return run.result(raceTimeoutMs);
}

function failed(cause: Error | undefined): WorkflowFailedError {
  return new WorkflowFailedError("Workflow execution failed", cause, RetryState.NON_RETRYABLE_FAILURE);
}

describe("TemporalPluginToolsEngine.startListing", () => {
  it("starts the connect workflow under the attempt's id on the shared runner queue", async () => {
    const { client, startCalls } = stubClient(async () => ({ tools: [] }));
    const engine = new TemporalPluginToolsEngine({ client, config: config(), logger: silentLogger });

    const run = await engine.startListing("att_1", INPUT, 45_000, RUNNER);

    expect(run.workflowId).toBe(`${CONNECT_WORKFLOW_NAME}/att_1`);
    expect(startCalls).toEqual([
      {
        workflowType: CONNECT_WORKFLOW_NAME,
        options: {
          workflowId: `${CONNECT_WORKFLOW_NAME}/att_1`,
          taskQueue: RUNNER_QUEUE,
          workflowRunTimeout: 45_000,
          args: [INPUT],
        },
      },
    ]);
  });

  it("starts a sandboxed listing on the queue its sandbox serves", async () => {
    const { client, startCalls } = stubClient(async () => ({ tools: [] }));
    const engine = new TemporalPluginToolsEngine({ client, config: config(), logger: silentLogger });

    await engine.startListing("att_2", INPUT, 45_000, { kind: "sandbox", name: "mcpconnect:att_2" });

    expect(startCalls[0]?.options["taskQueue"]).toBe("mcpconnect:att_2");
  });

  it("throws when the start fails", async () => {
    const client = {
      workflow: {
        start: async () => {
          throw new Error("namespace unavailable");
        },
      },
    } as unknown as Client;
    const engine = new TemporalPluginToolsEngine({ client, config: config(), logger: silentLogger });

    await expect(engine.startListing("att_1", INPUT, 1_000, RUNNER)).rejects.toThrow("namespace unavailable");
  });
});

describe("a listing run's outcome", () => {
  it("answers the run's output", async () => {
    const tools = [{ name: "list_orders", description: "Lists orders", destructiveHint: false }];
    expect(await settle(async () => ({ tools }))).toEqual({ ok: true, output: { tools } });
  });

  it("answers an empty output for a null result", async () => {
    expect(await settle(async () => null)).toEqual({ ok: true, output: {} });
  });

  it("finds the runner's application message anywhere in the cause chain", async () => {
    const application = ApplicationFailure.nonRetryable("orders server is unreachable");
    const activity = new ActivityFailure(
      "Activity task failed",
      "listPluginTools",
      "1",
      RetryState.NON_RETRYABLE_FAILURE,
      "runner@host",
      application,
    );
    expect(await settle(async () => Promise.reject(failed(activity)))).toEqual({
      ok: false,
      failure: { kind: "application", message: "orders server is unreachable" },
    });
  });

  it("lets the application arm win when a timeout is also in the chain", async () => {
    const timeout = new TimeoutFailure("timed out", undefined, TimeoutType.START_TO_CLOSE);
    const application = new ApplicationFailure("sign-in expired", "SignIn", true, undefined, timeout);
    const activity = new ActivityFailure(
      "Activity task failed",
      "listPluginTools",
      "1",
      RetryState.TIMEOUT,
      undefined,
      application,
    );
    expect(await settle(async () => Promise.reject(failed(activity)))).toEqual({
      ok: false,
      failure: { kind: "application", message: "sign-in expired" },
    });
  });

  it("classifies a run timeout", async () => {
    const timeout = new TimeoutFailure("Workflow run timed out", undefined, TimeoutType.START_TO_CLOSE);
    expect(await settle(async () => Promise.reject(failed(timeout)))).toEqual({
      ok: false,
      failure: { kind: "timeout" },
    });
  });

  it("answers the cause's own text for any other workflow failure", async () => {
    expect(await settle(async () => Promise.reject(failed(new Error("workflow panicked"))))).toEqual({
      ok: false,
      failure: { kind: "other", message: "workflow panicked" },
    });
  });

  it("falls back to the failure's own text when the cause has none", async () => {
    expect(await settle(async () => Promise.reject(failed(new Error(""))))).toEqual({
      ok: false,
      failure: { kind: "other", message: "Workflow execution failed" },
    });
    expect(await settle(async () => Promise.reject(failed(undefined)))).toEqual({
      ok: false,
      failure: { kind: "other", message: "Workflow execution failed" },
    });
  });

  it("classifies a run Temporal no longer knows", async () => {
    const notFound = new WorkflowNotFoundError("workflow not found", `${CONNECT_WORKFLOW_NAME}/att_1`, undefined);
    expect(await settle(async () => Promise.reject(notFound))).toEqual({
      ok: false,
      failure: { kind: "service-not-found" },
    });
  });

  it("answers any other error by its text, and a thrown non-error by its string", async () => {
    expect(await settle(async () => Promise.reject(new Error("connection reset")))).toEqual({
      ok: false,
      failure: { kind: "other", message: "connection reset" },
    });
    expect(await settle(async () => Promise.reject("socket closed"))).toEqual({
      ok: false,
      failure: { kind: "other", message: "socket closed" },
    });
  });
});

describe("the race backstop", () => {
  it("answers the run's outcome when the run settles first", async () => {
    expect(await settle(async () => ({ tools: [] }), 5_000)).toEqual({ ok: true, output: { tools: [] } });
  });

  it("answers Go's deadline text when the run outlives it", async () => {
    const never = () => new Promise<unknown>(() => {});
    expect(await settle(never, 5)).toEqual({
      ok: false,
      failure: { kind: "other", message: "context deadline exceeded" },
    });
  });
});

describe("newPluginToolsEngineStateProvider", () => {
  it("is disconnected until the first connect, then memoizes per client and rebuilds on a reconnect", () => {
    let current: Client | undefined;
    const manager = { getClient: () => current } as unknown as TemporalManager;
    const provider = newPluginToolsEngineStateProvider({ manager, config: config(), logger: silentLogger });

    expect(provider().connected).toBe(false);

    current = stubClient(async () => ({})).client;
    const first = provider();
    expect(first.connected).toBe(true);
    expect(provider()).toBe(first);

    current = stubClient(async () => ({})).client;
    const second = provider();
    expect(second.connected).toBe(true);
    expect(second).not.toBe(first);
  });
});
