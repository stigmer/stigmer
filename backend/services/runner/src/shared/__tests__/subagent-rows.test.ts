import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { SubAgentStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { cancelInProgressSubAgentProtos } from "../subagent-rows.js";

describe("cancelInProgressSubAgentProtos", () => {
  it("cancels IN_PROGRESS/PENDING protos in place and reports whether anything changed", () => {
    const running = create(SubAgentExecutionSchema, { id: "a", status: SubAgentStatus.SUB_AGENT_IN_PROGRESS });
    const pending = create(SubAgentExecutionSchema, { id: "b", status: SubAgentStatus.SUB_AGENT_PENDING });
    const completed = create(SubAgentExecutionSchema, {
      id: "c",
      status: SubAgentStatus.SUB_AGENT_COMPLETED,
      completedAt: "2026-01-01T00:00:00Z",
    });

    const changed = cancelInProgressSubAgentProtos([running, pending, completed]);

    expect(changed).toBe(true);
    expect(running.status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
    expect(running.completedAt).not.toBe("");
    expect(pending.status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
    // Terminal sub-agents are untouched.
    expect(completed.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    expect(completed.completedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("returns false when there is nothing to cancel", () => {
    const completed = create(SubAgentExecutionSchema, { id: "c", status: SubAgentStatus.SUB_AGENT_COMPLETED });
    expect(cancelInProgressSubAgentProtos([completed])).toBe(false);
    expect(cancelInProgressSubAgentProtos([])).toBe(false);
  });
});
