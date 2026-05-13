import { describe, it, expect } from "vitest";
import { buildApprovalState } from "../approval-state.js";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { MergedToolPolicy } from "../approval-policy.js";

function makePolicies(...entries: [string, string][]): Map<string, MergedToolPolicy> {
  const map = new Map<string, MergedToolPolicy>();
  for (const [key, toolName] of entries) {
    map.set(key, {
      toolName,
      mcpServerSlug: key.split("/")[0],
      requiresApproval: true,
      approvalMessage: `Execute tool: ${toolName}`,
    });
  }
  return map;
}

describe("buildApprovalState", () => {
  it("includes built-in allow list", () => {
    const state = buildApprovalState(new Map(), false);
    expect(state.builtInAllowList).toContain("Read");
    expect(state.builtInAllowList).toContain("Grep");
    expect(state.builtInAllowList).not.toContain("Shell");
  });

  it("populates mcpToolPolicies from merged policies", () => {
    const policies = makePolicies(
      ["planton/apply_service", "apply_service"],
      ["planton/delete_service", "delete_service"],
    );
    const state = buildApprovalState(policies, false);
    expect(state.mcpToolPolicies["apply_service"]).toEqual({
      requiresApproval: true,
      message: "Execute tool: apply_service",
    });
    expect(state.mcpToolPolicies["delete_service"]).toBeDefined();
  });

  it("sets autoApproveAll correctly", () => {
    const state = buildApprovalState(new Map(), true);
    expect(state.autoApproveAll).toBe(true);
  });

  it("populates approvedToolCallIds from APPROVE decisions", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc_1", ApprovalAction.APPROVE],
      ["tc_2", ApprovalAction.SKIP],
      ["tc_3", ApprovalAction.APPROVE],
    ]);
    const state = buildApprovalState(new Map(), false, decisions);
    expect(state.approvedToolCallIds).toEqual(["tc_1", "tc_3"]);
  });

  it("returns empty approved list when no decisions", () => {
    const state = buildApprovalState(new Map(), false);
    expect(state.approvedToolCallIds).toEqual([]);
  });
});
