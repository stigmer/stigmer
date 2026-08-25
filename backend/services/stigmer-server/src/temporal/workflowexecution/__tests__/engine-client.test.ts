/**
 * Pins the ConnectedWorkflowExecutionEngine implementation against
 * workflow_creator.go and the lifecycle steps' temporalClient contract:
 * the workflow name/ID, the runnerTaskQueue memo, the slim input's
 * omitempty JSON shape, the SignalWithStart lane, the one-null-argument
 * raw-signal convention, the WorkflowNotFoundError → seam-sentinel
 * mapping, and the provider's memoization/disconnected semantics.
 *
 * The Temporal Client is a recording double — the real dial path is
 * proven by local-execution.
 */
import { describe, expect, it } from "vitest";

import type { Client } from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/common";

import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  ENGINE_DISCONNECTED,
  EngineWorkflowNotFoundError,
  type StartWorkflowExecutionInput,
} from "../../../domain/workflowexecution/engine.js";
import {
  WORKFLOW_DEFAULT_EXECUTION_TARGET_LOCAL,
  WORKFLOW_ROUTING_GLOBAL,
  WorkflowExecutionTemporalConfig,
} from "../../../domain/workflowexecution/temporal/config.js";
import type { TemporalManager } from "../../manager.js";
import {
  newWorkflowExecutionEngineStateProvider,
  TemporalWorkflowExecutionEngine,
} from "../engine-client.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const config = new WorkflowExecutionTemporalConfig(
  "workflow_execution_stigmer",
  "stigmer_runner",
  WORKFLOW_ROUTING_GLOBAL,
  WORKFLOW_DEFAULT_EXECUTION_TARGET_LOCAL,
);

interface RecordedStart {
  readonly workflowType: string;
  readonly options: Record<string, unknown>;
}

interface RecordedHandleCall {
  readonly workflowId: string;
  readonly method: string;
  readonly args: unknown[];
}

function newClientDouble(handleError?: Error) {
  const starts: RecordedStart[] = [];
  const signalWithStarts: RecordedStart[] = [];
  const handleCalls: RecordedHandleCall[] = [];

  const client = {
    workflow: {
      start: async (workflowType: string, options: Record<string, unknown>) => {
        starts.push({ workflowType, options });
      },
      signalWithStart: async (
        workflowType: string,
        options: Record<string, unknown>,
      ) => {
        signalWithStarts.push({ workflowType, options });
      },
      getHandle: (workflowId: string) => ({
        signal: async (...args: unknown[]) => {
          if (handleError) throw handleError;
          handleCalls.push({ workflowId, method: "signal", args });
        },
        cancel: async () => {
          if (handleError) throw handleError;
          handleCalls.push({ workflowId, method: "cancel", args: [] });
        },
        terminate: async (reason: string) => {
          if (handleError) throw handleError;
          handleCalls.push({ workflowId, method: "terminate", args: [reason] });
        },
      }),
    },
  } as unknown as Client;

  return { client, starts, signalWithStarts, handleCalls };
}

function startInput(
  overrides: Partial<StartWorkflowExecutionInput> = {},
): StartWorkflowExecutionInput {
  return {
    executionId: "wfe-1",
    workflowInstanceId: "wfi-1",
    workflowId: "wf-1",
    orgId: "org-1",
    recoveryMode: false,
    executionTarget: ExecutionTarget.LOCAL,
    ...overrides,
  };
}

describe("TemporalWorkflowExecutionEngine", () => {
  it("starts the orchestrator with the pinned ID, queue, memo, and omitempty input", async () => {
    const double = newClientDouble();
    const engine = new TemporalWorkflowExecutionEngine({
      client: double.client,
      config,
      logger: silentLogger,
    });

    await engine.startInvokeWorkflow(startInput());

    expect(double.starts).toHaveLength(1);
    const start = double.starts[0]!;
    expect(start.workflowType).toBe("stigmer/workflow-execution/invoke");
    expect(start.options["workflowId"]).toBe(
      "stigmer/workflow-execution/invoke/wfe-1",
    );
    expect(start.options["taskQueue"]).toBe("workflow_execution_stigmer");
    expect(start.options["memo"]).toEqual({ runnerTaskQueue: "stigmer_runner" });
    // Go's omitempty shape: recovery_mode false is OMITTED, not false.
    expect(start.options["args"]).toEqual([
      {
        execution_id: "wfe-1",
        workflow_instance_id: "wfi-1",
        workflow_id: "wf-1",
        org_id: "org-1",
      },
    ]);
    // No workflowRunTimeout — durable execution (module header).
    expect(start.options["workflowRunTimeout"]).toBeUndefined();
  });

  it("omits every zero-valued optional field and carries recovery_mode when set", async () => {
    const double = newClientDouble();
    const engine = new TemporalWorkflowExecutionEngine({
      client: double.client,
      config,
      logger: silentLogger,
    });

    await engine.startInvokeWorkflow(
      startInput({
        workflowInstanceId: "",
        workflowId: "",
        orgId: "",
        recoveryMode: true,
      }),
    );

    expect(double.starts[0]!.options["args"]).toEqual([
      { execution_id: "wfe-1", recovery_mode: true },
    ]);
  });

  it("signalWithStart carries the signal, its payload, and the same start options", async () => {
    const double = newClientDouble();
    const engine = new TemporalWorkflowExecutionEngine({
      client: double.client,
      config,
      logger: silentLogger,
    });

    await engine.signalWithStart(startInput(), "relaySignal", {
      signalName: "human_input_step1",
      payload: { answer: 42 },
    });

    expect(double.signalWithStarts).toHaveLength(1);
    const call = double.signalWithStarts[0]!;
    expect(call.workflowType).toBe("stigmer/workflow-execution/invoke");
    expect(call.options["workflowId"]).toBe(
      "stigmer/workflow-execution/invoke/wfe-1",
    );
    expect(call.options["signal"]).toBe("relaySignal");
    expect(call.options["signalArgs"]).toEqual([
      { signalName: "human_input_step1", payload: { answer: 42 } },
    ]);
    expect(call.options["memo"]).toEqual({ runnerTaskQueue: "stigmer_runner" });
  });

  it("raw signal sends exactly one argument, null when the payload is absent", async () => {
    const double = newClientDouble();
    const engine = new TemporalWorkflowExecutionEngine({
      client: double.client,
      config,
      logger: silentLogger,
    });

    await engine.signalWorkflow("wf-id-1", "pause", "user requested");
    await engine.signalWorkflow("wf-id-1", "resume", undefined);

    expect(double.handleCalls).toEqual([
      { workflowId: "wf-id-1", method: "signal", args: ["pause", "user requested"] },
      // Go SignalWorkflow(nil) — one nil argument, not zero arguments.
      { workflowId: "wf-id-1", method: "signal", args: ["resume", null] },
    ]);
  });

  it("maps WorkflowNotFoundError onto the seam's sentinel for signal/cancel/terminate", async () => {
    const notFound = new WorkflowNotFoundError("gone", "wf-id-x", undefined);
    const double = newClientDouble(notFound);
    const engine = new TemporalWorkflowExecutionEngine({
      client: double.client,
      config,
      logger: silentLogger,
    });

    await expect(
      engine.signalWorkflow("wf-id-x", "pause", "r"),
    ).rejects.toBeInstanceOf(EngineWorkflowNotFoundError);
    await expect(engine.cancelWorkflow("wf-id-x")).rejects.toBeInstanceOf(
      EngineWorkflowNotFoundError,
    );
    await expect(
      engine.terminateWorkflow("wf-id-x", "reason"),
    ).rejects.toBeInstanceOf(EngineWorkflowNotFoundError);
  });

  it("passes non-not-found errors through unchanged", async () => {
    const boom = new Error("connection refused");
    const double = newClientDouble(boom);
    const engine = new TemporalWorkflowExecutionEngine({
      client: double.client,
      config,
      logger: silentLogger,
    });

    await expect(engine.cancelWorkflow("wf-id-x")).rejects.toBe(boom);
  });
});

describe("newWorkflowExecutionEngineStateProvider", () => {
  it("is disconnected until the first client and memoizes per client instance", () => {
    let client: Client | undefined;
    const manager = {
      getClient: () => client,
    } as unknown as TemporalManager;

    const provider = newWorkflowExecutionEngineStateProvider({
      manager,
      config,
      logger: silentLogger,
    });

    expect(provider()).toBe(ENGINE_DISCONNECTED);

    client = newClientDouble().client;
    const first = provider();
    expect(first.connected).toBe(true);
    // Same client → the SAME memoized state object.
    expect(provider()).toBe(first);

    // A reconnect swaps the client → a fresh engine wrapping it.
    client = newClientDouble().client;
    const second = provider();
    expect(second.connected).toBe(true);
    expect(second).not.toBe(first);
  });
});
