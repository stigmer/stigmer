/**
 * `shared/execution-target.ts`: `sessionIdOf` reads the session a turn runs
 * in from the execution's `target` oneof, and reads "" for every shape that
 * names no existing session (an unset target, a session_spec arm, an empty
 * session_id, no spec at all), so a reader's "no session" branch is taken
 * the same way whatever the shape.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentRunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/spec_pb";
import { sessionIdOf } from "../execution-target.js";

describe("sessionIdOf", () => {
  it("reads the session_id arm", () => {
    const spec = create(AgentRunSpecSchema, {
      target: { case: "sessionId", value: "ses_1" },
    });
    expect(sessionIdOf(spec)).toBe("ses_1");
  });

  it("reads '' for a new conversation's session_spec arm", () => {
    const spec = create(AgentRunSpecSchema, {
      target: { case: "sessionSpec", value: {} },
    });
    expect(sessionIdOf(spec)).toBe("");
  });

  it("reads '' for an unset target and for no spec", () => {
    expect(sessionIdOf(create(AgentRunSpecSchema, {}))).toBe("");
    expect(sessionIdOf(undefined)).toBe("");
  });
});
