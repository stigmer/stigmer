import { describe, it, expect, vi } from "vitest";
import { buildSubAgentMiddleware } from "../subagent-wiring.js";
import { createCostCapMiddleware } from "../../../middleware/cost-cap.js";
import * as approvalGateModule from "../../../middleware/approval-gate.js";

describe("buildSubAgentMiddleware", () => {
  it("returns the correct middleware order without cost cap", () => {
    const stack = buildSubAgentMiddleware();

    expect(stack).toHaveLength(4);
    expect(stack[0].name).toBe("LoopDetectionMiddleware");
    expect(stack[1].name).toBe("ExecutionBudgetMiddleware");
    expect(stack[2].name).toBe("ToolTruncationMiddleware");
    expect(stack[3].name).toBe("ErrorHintsMiddleware");
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

    expect(stack).toHaveLength(5);
    expect(stack[3].name).toBe("CostCapSubAgentView");
    expect(stack[4].name).toBe("ErrorHintsMiddleware");
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

    // loop, budget, truncation, approval gate, error hints
    expect(stack).toHaveLength(5);
    expect(stack[3].name).toBe("ApprovalGateMiddleware");
    expect(stack[3].wrapToolCall).toBeDefined();
  });

  it("omits the approval gate when approvalGate is null (auto-approve-all parity)", () => {
    const stack = buildSubAgentMiddleware({ approvalGate: null });

    expect(stack).toHaveLength(4);
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

    // loop, budget, truncation, approval gate, cost cap view, error hints.
    // Hints AFTER the gate matches the parent nesting: the gate's HITL
    // interrupt stays outside the hints' try/catch (issue #255).
    expect(stack).toHaveLength(6);
    expect(stack[3].name).toBe("ApprovalGateMiddleware");
    expect(stack[4].name).toBe("CostCapSubAgentView");
    expect(stack[5].name).toBe("ErrorHintsMiddleware");
  });

  // captureIgnored is the structural coupling that makes sub-agent gitignored
  // capture safe (DD-19): the gate flows gitignored writes into CAS iff a CAS
  // observer backs the sub-agent's backend (compileSubagents passes !!casObserver).
  describe("captureIgnored (sub-agent CAS routing)", () => {
    it("captureIgnored:true inherits the parent gate verbatim (CAS routing + secret sink preserved)", () => {
      const recordBlockedSecret = vi.fn();
      const parentGate = {
        policies: new Map(),
        toolServerMap: new Map(),
        captureIgnored: true,
        recordBlockedSecret,
      };
      const spy = vi.spyOn(approvalGateModule, "createApprovalGateMiddleware");

      buildSubAgentMiddleware({ approvalGate: parentGate, captureIgnored: true });

      const cfg = spy.mock.calls[0]![0];
      expect(cfg.captureIgnored).toBe(true);
      expect(cfg.recordBlockedSecret).toBe(recordBlockedSecret);
      spy.mockRestore();
    });

    it("regression lock: without captureIgnored, CAS routing is forced OFF and the secret sink dropped even if the parent gate had them", () => {
      const recordBlockedSecret = vi.fn();
      // A parent gate that DOES route gitignored writes into CAS — the sub-agent
      // must not inherit that unless a CAS observer explicitly backs it, else it
      // would apply unobserved, unreviewable bytes.
      const parentGate = {
        policies: new Map(),
        toolServerMap: new Map(),
        captureIgnored: true,
        recordBlockedSecret,
      };
      const spy = vi.spyOn(approvalGateModule, "createApprovalGateMiddleware");

      buildSubAgentMiddleware({ approvalGate: parentGate });

      const cfg = spy.mock.calls[0]![0];
      expect(cfg.captureIgnored).toBe(false);
      expect(cfg.recordBlockedSecret).toBeUndefined();
      spy.mockRestore();
    });
  });
});
