/**
 * A recording stub of the connected workflow-execution engine for unit
 * tests — the #21 implementation's test double. Records every call and
 * throws the configured error per operation (EngineWorkflowNotFoundError
 * for the warn-and-proceed arms, plain errors for the Internal arms).
 */
import type { JsonValue } from "@bufbuild/protobuf";

import type {
  ConnectedWorkflowExecutionEngine,
  StartWorkflowExecutionInput,
  WorkflowExecutionEngineState,
} from "../engine.js";

export interface EngineCall {
  readonly method: string;
  readonly args: unknown[];
}

export interface EngineStub {
  readonly engine: ConnectedWorkflowExecutionEngine;
  readonly state: WorkflowExecutionEngineState;
  readonly calls: EngineCall[];
  failures: Partial<Record<keyof ConnectedWorkflowExecutionEngine, Error>>;
}

export function stubConnectedEngine(): EngineStub {
  const calls: EngineCall[] = [];
  const failures: EngineStub["failures"] = {};

  async function record(method: keyof ConnectedWorkflowExecutionEngine, args: unknown[]): Promise<void> {
    calls.push({ method, args });
    const failure = failures[method];
    if (failure !== undefined) {
      throw failure;
    }
  }

  const engine: ConnectedWorkflowExecutionEngine = {
    startInvokeWorkflow: (input: StartWorkflowExecutionInput) =>
      record("startInvokeWorkflow", [input]),
    signalWithStart: (
      input: StartWorkflowExecutionInput,
      signalName: string,
      payload: JsonValue,
    ) => record("signalWithStart", [input, signalName, payload]),
    signalWorkflow: (
      workflowId: string,
      signalName: string,
      payload: JsonValue | undefined,
    ) => record("signalWorkflow", [workflowId, signalName, payload]),
    cancelWorkflow: (workflowId: string) =>
      record("cancelWorkflow", [workflowId]),
    terminateWorkflow: (workflowId: string, reason: string) =>
      record("terminateWorkflow", [workflowId, reason]),
  };

  return {
    engine,
    state: { connected: true, engine },
    calls,
    failures,
  };
}
