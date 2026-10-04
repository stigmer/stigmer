/**
 * Pins parentIdOf (../shapes.ts) through a oneof: an execution's
 * authorization parent is named by `kind_meta` as spec field `session_id`,
 * which the contract holds inside the `target` oneof. The tuple written at
 * create and the list scope's later question both read it here, so both
 * must find the session the turn belongs to — and no parent for a turn
 * whose oneof holds the other member or nothing.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import { parentIdOf } from "../shapes.js";

describe("parentIdOf through a oneof", () => {
  it("reads the session a turn belongs to", () => {
    const turn = create(AgentExecutionSchema, {
      spec: { target: { case: "sessionId", value: "ses_1" } },
    });
    expect(parentIdOf(turn, "session_id")).toBe("ses_1");
  });

  it("reads no parent when the oneof holds a new session's spec", () => {
    const turn = create(AgentExecutionSchema, {
      spec: { target: { case: "sessionSpec", value: {} } },
    });
    expect(parentIdOf(turn, "session_id")).toBe("");
  });

  it("reads no parent when the oneof is unset", () => {
    const turn = create(AgentExecutionSchema, { spec: {} });
    expect(parentIdOf(turn, "session_id")).toBe("");
  });

  it("still reads a plain field by its name", () => {
    expect(parentIdOf({ spec: { workflowId: "wfl_1" } }, "workflow_id")).toBe(
      "wfl_1",
    );
  });
});
