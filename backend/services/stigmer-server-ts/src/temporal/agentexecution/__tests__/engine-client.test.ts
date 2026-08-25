/**
 * Engine-client tests — pins TemporalExecutionEngine's wire contract
 * (ports workflow_creator.go's assertions plus the lifecycle mapping):
 *
 *   - startInvokeWorkflow: the byte-pinned workflow type + workflow-ID
 *     format, the stigmer task queue, the ONE memo key with the
 *     dispatch-resolved value, the slim snake_case input with Go's
 *     omitempty shape (base64 callback token; harness/execution_target
 *     from dispatch), and NO run timeout;
 *   - dispatch failures throw EngineDispatchError with the resolver's
 *     message VERBATIM (the create step surfaces it as
 *     FailedPrecondition — Go's boundary);
 *   - lifecycle ops signal/cancel/terminate the pinned workflow ID and
 *     map the SDK's workflow-not-found onto EngineWorkflowNotFoundError
 *     (Go serviceerror.NotFound → ErrWorkflowNotFound);
 *   - the engine-state provider: DISCONNECTED until the first connect,
 *     memoized per client instance, re-built on client swap (reconnect).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { create } from "@bufbuild/protobuf";
import type { Client } from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/common";
import { afterEach, describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  ExecutionTarget,
  Harness,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  EngineDispatchError,
  EngineWorkflowNotFoundError,
} from "../../../domain/agentexecution/engine.js";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_LOCAL,
  ROUTING_GLOBAL,
} from "../../../domain/agentexecution/temporal/config.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import type { TemporalManager } from "../../manager.js";
import {
  newExecutionEngineStateProvider,
  TemporalExecutionEngine,
} from "../engine-client.js";
import { DEFAULT_ACTIVITY_TASK_QUEUE } from "../names.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function newStore(): Store {
  const dir = mkdtempSync(path.join(tmpdir(), "engine-client-test-"));
  const store = SqliteStore.open(path.join(dir, "engine.sqlite"), silentLogger);
  cleanups.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function config(): AgentExecutionTemporalConfig {
  return new AgentExecutionTemporalConfig(
    "agent_execution_stigmer",
    DEFAULT_ACTIVITY_TASK_QUEUE,
    ROUTING_GLOBAL,
    DEFAULT_EXECUTION_TARGET_LOCAL,
  );
}

interface StartCall {
  readonly workflowType: string;
  readonly options: Record<string, unknown>;
}

interface HandleCall {
  readonly workflowId: string;
  readonly method: string;
  readonly args: unknown[];
}

function stubClient(behavior?: { handleError?: Error }) {
  const startCalls: StartCall[] = [];
  const handleCalls: HandleCall[] = [];
  const client = {
    workflow: {
      start: async (
        workflowType: string,
        options: Record<string, unknown>,
      ): Promise<void> => {
        startCalls.push({ workflowType, options });
      },
      getHandle: (workflowId: string) => ({
        signal: async (...args: unknown[]) => {
          handleCalls.push({ workflowId, method: "signal", args });
          if (behavior?.handleError) throw behavior.handleError;
        },
        cancel: async () => {
          handleCalls.push({ workflowId, method: "cancel", args: [] });
          if (behavior?.handleError) throw behavior.handleError;
        },
        terminate: async (reason: string) => {
          handleCalls.push({ workflowId, method: "terminate", args: [reason] });
          if (behavior?.handleError) throw behavior.handleError;
        },
      }),
    },
  } as unknown as Client;
  return { client, startCalls, handleCalls };
}

function startInput(overrides: Partial<Parameters<TemporalExecutionEngine["startInvokeWorkflow"]>[0]> = {}) {
  return {
    executionId: "aex_1",
    sessionId: "",
    agentId: "agt_1",
    callbackToken: new Uint8Array(),
    autoApproveAll: false,
    parentWorkflowId: "",
    activityTaskQueueOverride: "",
    ...overrides,
  };
}

describe("TemporalExecutionEngine.startInvokeWorkflow", () => {
  it("starts the byte-pinned workflow type with the memo, queue, and slim input", async () => {
    const { client, startCalls } = stubClient();
    const engine = new TemporalExecutionEngine({
      client,
      config: config(),
      store: newStore(),
      logger: silentLogger,
    });

    await engine.startInvokeWorkflow(
      startInput({ callbackToken: Buffer.from("tok"), parentWorkflowId: "parent-wf" }),
    );

    expect(startCalls).toHaveLength(1);
    const call = startCalls[0]!;
    expect(call.workflowType).toBe("stigmer/agent-execution/invoke");
    expect(call.options["workflowId"]).toBe("stigmer/agent-execution/invoke/aex_1");
    expect(call.options["taskQueue"]).toBe("agent_execution_stigmer");
    expect(call.options["memo"]).toEqual({
      activityTaskQueue: DEFAULT_ACTIVITY_TASK_QUEUE,
    });
    // No run timeout: HITL can block for days (workflow_creator.go).
    expect(call.options["workflowRunTimeout"]).toBeUndefined();
    expect(call.options["args"]).toEqual([
      {
        execution_id: "aex_1",
        session_id: "",
        agent_id: "agt_1",
        callback_token: Buffer.from("tok").toString("base64"),
        parent_workflow_id: "parent-wf",
        // Dispatch defaults: harness NATIVE (nonzero — Go's omitempty
        // keeps it, so the wire carries it) and target resolved LOCAL.
        harness: Harness.NATIVE,
        execution_target: ExecutionTarget.LOCAL,
      },
    ]);
  });

  it("resolves session routing through dispatch (harness + target in the input)", async () => {
    const { client, startCalls } = stubClient();
    const store = newStore();
    await store.saveResource(
      ApiResourceKind.session,
      "ses_1",
      SessionSchema,
      create(SessionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Session",
        metadata: { id: "ses_1", name: "s", org: "o" },
        spec: {
          agentInstanceId: "ain_1",
          harness: Harness.CURSOR,
          executionTarget: ExecutionTarget.CLOUD,
        },
      }),
    );
    const engine = new TemporalExecutionEngine({
      client,
      config: config(),
      store,
      logger: silentLogger,
    });

    await engine.startInvokeWorkflow(startInput({ sessionId: "ses_1" }));

    const input = (startCalls[0]!.options["args"] as unknown[])[0] as Record<string, unknown>;
    expect(input["harness"]).toBe(Harness.CURSOR);
    expect(input["execution_target"]).toBe(ExecutionTarget.CLOUD);
    // Omitempty shape: empty callback token and parent id carry NO keys.
    expect("callback_token" in input).toBe(false);
    expect("parent_workflow_id" in input).toBe(false);
  });

  it("wraps dispatch-resolution failures in EngineDispatchError with the message verbatim", async () => {
    const { client } = stubClient();
    const store = newStore();
    await store.close(); // Forces a non-NotFound store failure in dispatch.
    const engine = new TemporalExecutionEngine({
      client,
      config: config(),
      store,
      logger: silentLogger,
    });

    await expect(
      engine.startInvokeWorkflow(startInput({ sessionId: "ses_any" })),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof EngineDispatchError &&
        error.message.startsWith("failed to load session for dispatch:"),
    );
  });
});

describe("TemporalExecutionEngine lifecycle operations", () => {
  it("targets the pinned workflow ID for signal/cancel/terminate", async () => {
    const { client, handleCalls } = stubClient();
    const engine = new TemporalExecutionEngine({
      client,
      config: config(),
      store: newStore(),
      logger: silentLogger,
    });

    await engine.signalApprovalGateResolved("aex_2");
    await engine.signalPause("aex_2", "Paused by user");
    await engine.signalResume("aex_2");
    await engine.cancelWorkflow("aex_2");
    await engine.terminateWorkflow("aex_2", "Terminated by user");

    expect(handleCalls.map((call) => [call.workflowId, call.method, ...call.args])).toEqual([
      ["stigmer/agent-execution/invoke/aex_2", "signal", "approvalGateResolved"],
      ["stigmer/agent-execution/invoke/aex_2", "signal", "pause", "Paused by user"],
      ["stigmer/agent-execution/invoke/aex_2", "signal", "resume"],
      ["stigmer/agent-execution/invoke/aex_2", "cancel"],
      ["stigmer/agent-execution/invoke/aex_2", "terminate", "Terminated by user"],
    ]);
  });

  it("maps the SDK's workflow-not-found onto the seam's sentinel", async () => {
    const { client } = stubClient({
      handleError: new WorkflowNotFoundError("nope", "wf", undefined),
    });
    const engine = new TemporalExecutionEngine({
      client,
      config: config(),
      store: newStore(),
      logger: silentLogger,
    });

    for (const op of [
      () => engine.signalApprovalGateResolved("aex_3"),
      () => engine.signalPause("aex_3", "r"),
      () => engine.signalResume("aex_3"),
      () => engine.cancelWorkflow("aex_3"),
      () => engine.terminateWorkflow("aex_3", "r"),
    ]) {
      await expect(op()).rejects.toBeInstanceOf(EngineWorkflowNotFoundError);
    }
  });

  it("passes through other errors unmapped", async () => {
    const { client } = stubClient({ handleError: new Error("connection reset") });
    const engine = new TemporalExecutionEngine({
      client,
      config: config(),
      store: newStore(),
      logger: silentLogger,
    });
    await expect(engine.signalResume("aex_4")).rejects.toThrow("connection reset");
  });
});

describe("newExecutionEngineStateProvider", () => {
  it("is DISCONNECTED until the first connect, then memoizes per client and re-builds on swap", () => {
    let current: Client | undefined;
    const manager = { getClient: () => current } as unknown as TemporalManager;
    const provider = newExecutionEngineStateProvider({
      manager,
      config: config(),
      store: newStore(),
      logger: silentLogger,
    });

    expect(provider().connected).toBe(false);

    const { client: clientA } = stubClient();
    current = clientA;
    const stateA = provider();
    expect(stateA.connected).toBe(true);
    // Memoized: the same client yields the same state object.
    expect(provider()).toBe(stateA);

    // A reconnect swaps the client; the provider rebuilds the engine.
    const { client: clientB } = stubClient();
    current = clientB;
    const stateB = provider();
    expect(stateB.connected).toBe(true);
    expect(stateB).not.toBe(stateA);
  });
});
