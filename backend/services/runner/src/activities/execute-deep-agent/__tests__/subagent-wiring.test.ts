import { describe, it, expect } from "vitest";
import { buildSubAgentMiddleware } from "../subagent-wiring.js";
import { createCostCapMiddleware } from "../../../middleware/cost-cap.js";

describe("buildSubAgentMiddleware", () => {
  it("returns the correct middleware order without cost cap", () => {
    const stack = buildSubAgentMiddleware();

    expect(stack).toHaveLength(3);
    expect(stack[0].name).toBe("LoopDetectionMiddleware");
    expect(stack[1].name).toBe("ExecutionBudgetMiddleware");
    expect(stack[2].name).toBe("ToolTruncationMiddleware");
  });

  it("includes cost cap view when parent cost cap is provided", () => {
    const parentCostCap = createCostCapMiddleware({
      maxCostUsd: 10,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      cacheReadPricePerMillion: 0.3,
      warningPct: 80,
    });

    const stack = buildSubAgentMiddleware({ costCap: parentCostCap });

    expect(stack).toHaveLength(4);
    expect(stack[3].name).toBe("CostCapSubAgentView");
  });

  it("sub-agent cost cap view shares parent state", () => {
    const parentCostCap = createCostCapMiddleware({
      maxCostUsd: 1,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      cacheReadPricePerMillion: 0.3,
      warningPct: 80,
    });

    const stack = buildSubAgentMiddleware({ costCap: parentCostCap });

    expect(parentCostCap.runningCost).toBe(0);

    const subView = stack[3];
    expect(subView.afterModel).toBeDefined();
    expect(subView.wrapToolCall).toBeDefined();
    expect(subView.beforeAgent).toBeUndefined();
  });

  it("execution budget uses periodic mode (interval=30, max=4)", () => {
    const stack = buildSubAgentMiddleware();
    const budgetMiddleware = stack[1];

    expect(budgetMiddleware.name).toBe("ExecutionBudgetMiddleware");
    expect(budgetMiddleware.wrapModelCall).toBeDefined();
  });

  it("loop detection is independent per sub-agent call", () => {
    const stack1 = buildSubAgentMiddleware();
    const stack2 = buildSubAgentMiddleware();

    expect(stack1[0]).not.toBe(stack2[0]);
  });

  it("accepts custom tool truncation config", () => {
    const stack = buildSubAgentMiddleware({
      toolTruncation: { maxChars: 5000 },
    });

    expect(stack[2].name).toBe("ToolTruncationMiddleware");
  });

  it("installs the approval gate when an approvalGate config is provided", () => {
    const stack = buildSubAgentMiddleware({
      approvalGate: { policies: new Map(), toolServerMap: new Map() },
    });

    // loop, budget, truncation, approval gate
    expect(stack).toHaveLength(4);
    expect(stack[3].name).toBe("ApprovalGateMiddleware");
    expect(stack[3].wrapToolCall).toBeDefined();
  });

  it("omits the approval gate when approvalGate is null (auto-approve-all parity)", () => {
    const stack = buildSubAgentMiddleware({ approvalGate: null });

    expect(stack).toHaveLength(3);
    expect(stack.some((m) => m.name === "ApprovalGateMiddleware")).toBe(false);
  });

  it("orders the gate before the cost-cap view", () => {
    const parentCostCap = createCostCapMiddleware({
      maxCostUsd: 10,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      cacheReadPricePerMillion: 0.3,
      warningPct: 80,
    });

    const stack = buildSubAgentMiddleware({
      costCap: parentCostCap,
      approvalGate: { policies: new Map(), toolServerMap: new Map() },
    });

    // loop, budget, truncation, approval gate, cost cap view
    expect(stack).toHaveLength(5);
    expect(stack[3].name).toBe("ApprovalGateMiddleware");
    expect(stack[4].name).toBe("CostCapSubAgentView");
  });
});
