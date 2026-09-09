// Unit arms for the submit-approval seam: one submit, then the response's
// pending_approvals must equal what the decision leaves behind — a match
// returns the response, a mismatch is red under the caller's label, and in
// neither case is the decision submitted twice. Pure: a hand-built execution
// and a stubbed submit, no target.
// Domain: conformance support (execution engine).
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { describe, expect, it, vi } from "vitest";
import { submitApprovalPerContract } from "../agentexecutions";

function executionWithPending(toolCallIds: string[]): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id: "aex_unit" },
    status: { pendingApprovals: toolCallIds.map((toolCallId) => ({ toolCallId })) },
  });
}

describe("submitApprovalPerContract", () => {
  it("submits once and returns the response when pending_approvals matches the decision", async () => {
    const settled = executionWithPending([]);
    const submit = vi.fn(async () => settled);
    const response = await submitApprovalPerContract({
      submit,
      expectedRemaining: 0,
      label: "approve clears the gate",
    });
    expect(response).toBe(settled);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("accepts a partially resolved gate when the decision leaves that many pending", async () => {
    const oneLeft = executionWithPending(["call_second"]);
    const response = await submitApprovalPerContract({
      submit: async () => oneLeft,
      expectedRemaining: 1,
      label: "one gate remains after the first approve",
    });
    expect(response).toBe(oneLeft);
  });

  it("is red under the caller's label when the response still lists the decided call — and never re-submits", async () => {
    const submit = vi.fn(async () => executionWithPending(["call_a"]));
    await expect(
      submitApprovalPerContract({
        submit,
        expectedRemaining: 0,
        label: "approve clears the gate",
      }),
    ).rejects.toThrow("approve clears the gate");
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
