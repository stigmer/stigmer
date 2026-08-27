/**
 * Pins the execution-engine seam: the modeled availability state and the
 * EnsureEngineAvailable gate (create.go ensureEngineAvailableStep). The
 * disconnected refusal copy is byte-pinned by the conformance engine-gate
 * test too; this pins the seam mechanics — the provider is consulted at
 * EXECUTION time (a reconnect between requests must be observed, Go's
 * SetWorkflowCreator re-injection).
 */
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { RequestContext } from "../../../pipeline/request-context.js";
import { ENGINE_UNAVAILABLE_MESSAGE } from "../constants.js";
import {
  ENGINE_DISCONNECTED,
  newEnsureEngineAvailableStep,
} from "../engine.js";
import type { ExecutionEngineState } from "../engine.js";
import { stubConnectedEngine } from "./engine-stub.js";

function contextFor(): RequestContext<typeof AgentExecutionSchema> {
  return new RequestContext(
    AgentExecutionSchema,
    create(AgentExecutionSchema, {}),
    testCallerIdentity(),
    ApiResourceKind.agent_execution,
  );
}

describe("the execution-engine seam", () => {
  it("refuses Unavailable with the pinned copy while disconnected", () => {
    const step = newEnsureEngineAvailableStep(() => ENGINE_DISCONNECTED);
    try {
      step.execute(contextFor());
      throw new Error("expected the engine gate to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      const connectError = error as ConnectError;
      expect(connectError.code).toBe(Code.Unavailable);
      expect(connectError.rawMessage).toBe(ENGINE_UNAVAILABLE_MESSAGE);
    }
  });

  it("passes while connected", () => {
    const connected: ExecutionEngineState = {
      connected: true,
      engine: stubConnectedEngine(),
    };
    const step = newEnsureEngineAvailableStep(() => connected);
    expect(() => step.execute(contextFor())).not.toThrow();
  });

  it("observes the CURRENT state at execution time (reconnect semantics)", () => {
    let state: ExecutionEngineState = ENGINE_DISCONNECTED;
    const step = newEnsureEngineAvailableStep(() => state);

    expect(() => step.execute(contextFor())).toThrow(ConnectError);

    state = { connected: true, engine: stubConnectedEngine() };
    expect(() => step.execute(contextFor())).not.toThrow();
  });
});
