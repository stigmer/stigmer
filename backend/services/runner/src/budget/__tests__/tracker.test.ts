import { describe, it, expect } from "vitest";
import { BudgetTracker, extractCostFromOutput, type WorkflowBudget } from "../tracker.js";

const START = 1_000_000;

describe("BudgetTracker", () => {
  describe("unlimited (no budget)", () => {
    it("returns ok=true when budget is undefined", () => {
      const t = new BudgetTracker(undefined, START);
      t.record(999_999, 100_000, 50_000);
      const result = t.check(START + 3_600_000);
      expect(result.ok).toBe(true);
      expect(result.exceeded).toBe(false);
    });

    it("costRemaining returns -1 when unlimited", () => {
      const t = new BudgetTracker(undefined, START);
      expect(t.costRemaining()).toBe(-1);
    });

    it("tokensRemaining returns -1 when unlimited", () => {
      const t = new BudgetTracker(undefined, START);
      expect(t.tokensRemaining()).toBe(-1);
    });
  });

  describe("record", () => {
    it("accumulates cost and token usage", () => {
      const t = new BudgetTracker(undefined, START);
      t.record(100, 50, 30);
      t.record(200, 25, 10);
      expect(t.costMicros).toBe(300);
      expect(t.inputTokens).toBe(75);
      expect(t.outputTokens).toBe(40);
      expect(t.totalTokens()).toBe(115);
    });
  });

  describe("cost limit", () => {
    const budget: WorkflowBudget = { maxCostMicros: 1000 };

    it("passes when under limit", () => {
      const t = new BudgetTracker(budget, START);
      t.record(500, 0, 0);
      const result = t.check(START);
      expect(result.ok).toBe(true);
      expect(result.warningPct).toBeCloseTo(0.5);
    });

    it("exceeds when over limit", () => {
      const t = new BudgetTracker(budget, START);
      t.record(1001, 0, 0);
      const result = t.check(START);
      expect(result.ok).toBe(false);
      expect(result.exceeded).toBe(true);
      expect(result.exceededLimit).toBe("cost");
      expect(result.exceededMessage).toContain("1001/1000");
    });

    it("costRemaining returns remaining budget", () => {
      const t = new BudgetTracker(budget, START);
      t.record(300, 0, 0);
      expect(t.costRemaining()).toBe(700);
    });

    it("costRemaining returns 0 when exceeded", () => {
      const t = new BudgetTracker(budget, START);
      t.record(2000, 0, 0);
      expect(t.costRemaining()).toBe(0);
    });
  });

  describe("token limit", () => {
    const budget: WorkflowBudget = { maxTotalTokens: 10_000 };

    it("passes when under limit", () => {
      const t = new BudgetTracker(budget, START);
      t.record(0, 3000, 2000);
      const result = t.check(START);
      expect(result.ok).toBe(true);
      expect(result.warningPct).toBeCloseTo(0.5);
    });

    it("exceeds when input + output exceeds limit", () => {
      const t = new BudgetTracker(budget, START);
      t.record(0, 6000, 5000);
      const result = t.check(START);
      expect(result.ok).toBe(false);
      expect(result.exceeded).toBe(true);
      expect(result.exceededLimit).toBe("tokens");
      expect(result.exceededMessage).toContain("11000/10000");
    });

    it("tokensRemaining returns remaining budget", () => {
      const t = new BudgetTracker(budget, START);
      t.record(0, 3000, 1000);
      expect(t.tokensRemaining()).toBe(6000);
    });

    it("tokensRemaining returns 0 when exceeded", () => {
      const t = new BudgetTracker(budget, START);
      t.record(0, 6000, 5000);
      expect(t.tokensRemaining()).toBe(0);
    });
  });

  describe("duration limit", () => {
    const budget: WorkflowBudget = { maxDurationSeconds: 60 };

    it("passes when under limit", () => {
      const t = new BudgetTracker(budget, START);
      const result = t.check(START + 30_000);
      expect(result.ok).toBe(true);
      expect(result.warningPct).toBeCloseTo(0.5);
    });

    it("exceeds when elapsed > limit", () => {
      const t = new BudgetTracker(budget, START);
      const result = t.check(START + 61_000);
      expect(result.ok).toBe(false);
      expect(result.exceeded).toBe(true);
      expect(result.exceededLimit).toBe("duration");
      expect(result.exceededMessage).toContain("61s/60s");
    });
  });

  describe("multiple limits", () => {
    it("checks cost before tokens before duration", () => {
      const budget: WorkflowBudget = {
        maxCostMicros: 100,
        maxTotalTokens: 1000,
        maxDurationSeconds: 300,
      };
      const t = new BudgetTracker(budget, START);
      t.record(200, 500, 500);
      const result = t.check(START + 100_000);
      expect(result.exceededLimit).toBe("cost");
    });

    it("reports token limit when cost is within budget", () => {
      const budget: WorkflowBudget = {
        maxCostMicros: 10_000,
        maxTotalTokens: 1000,
      };
      const t = new BudgetTracker(budget, START);
      t.record(50, 600, 500);
      const result = t.check(START);
      expect(result.exceededLimit).toBe("tokens");
    });

    it("warningPct reflects the tightest limit when ok", () => {
      const budget: WorkflowBudget = {
        maxCostMicros: 1000,
        maxTotalTokens: 10_000,
      };
      const t = new BudgetTracker(budget, START);
      t.record(800, 1000, 500);
      const result = t.check(START);
      expect(result.ok).toBe(true);
      expect(result.warningPct).toBeCloseTo(0.8);
    });
  });

  describe("policy", () => {
    it("defaults to terminate when unspecified", () => {
      const budget: WorkflowBudget = { maxCostMicros: 100 };
      const t = new BudgetTracker(budget, START);
      t.record(200, 0, 0);
      const result = t.check(START);
      expect(result.policy).toBe("terminate");
    });

    it("uses configured policy", () => {
      const budget: WorkflowBudget = {
        maxCostMicros: 100,
        onExceeded: "warn",
      };
      const t = new BudgetTracker(budget, START);
      t.record(200, 0, 0);
      const result = t.check(START);
      expect(result.policy).toBe("warn");
    });

    it("returns policy in ok results", () => {
      const budget: WorkflowBudget = {
        maxCostMicros: 1000,
        onExceeded: "human_review",
      };
      const t = new BudgetTracker(budget, START);
      const result = t.check(START);
      expect(result.ok).toBe(true);
      expect(result.policy).toBe("human_review");
    });
  });
});

describe("extractCostFromOutput", () => {
  it("extracts __stigmer_* prefixed keys", () => {
    const output = {
      __stigmer_cost_micros: 500,
      __stigmer_input_tokens: 1000,
      __stigmer_output_tokens: 200,
      result: "some text",
    };
    const cost = extractCostFromOutput(output);
    expect(cost.costMicros).toBe(500);
    expect(cost.inputTokens).toBe(1000);
    expect(cost.outputTokens).toBe(200);
  });

  it("falls back to unprefixed keys (LLM activity output)", () => {
    const output = {
      cost_micros: 0,
      input_tokens: 800,
      output_tokens: 150,
      result: "text",
    };
    const cost = extractCostFromOutput(output);
    expect(cost.inputTokens).toBe(800);
    expect(cost.outputTokens).toBe(150);
  });

  it("prefers __stigmer_* over unprefixed when both present", () => {
    const output = {
      __stigmer_input_tokens: 100,
      input_tokens: 999,
    };
    const cost = extractCostFromOutput(output);
    expect(cost.inputTokens).toBe(100);
  });

  it("returns zeroes for null output", () => {
    const cost = extractCostFromOutput(null);
    expect(cost.costMicros).toBe(0);
    expect(cost.inputTokens).toBe(0);
    expect(cost.outputTokens).toBe(0);
  });

  it("returns zeroes for undefined output", () => {
    const cost = extractCostFromOutput(undefined);
    expect(cost.costMicros).toBe(0);
  });

  it("returns zeroes for non-object output", () => {
    const cost = extractCostFromOutput("some string");
    expect(cost.costMicros).toBe(0);
  });

  it("floors fractional values", () => {
    const output = { input_tokens: 10.7, output_tokens: 5.3 };
    const cost = extractCostFromOutput(output);
    expect(cost.inputTokens).toBe(10);
    expect(cost.outputTokens).toBe(5);
  });

  it("treats negative values as zero", () => {
    const output = { input_tokens: -5, output_tokens: 10 };
    const cost = extractCostFromOutput(output);
    expect(cost.inputTokens).toBe(0);
    expect(cost.outputTokens).toBe(10);
  });

  it("treats non-numeric values as zero", () => {
    const output = { input_tokens: "lots", output_tokens: true };
    const cost = extractCostFromOutput(output);
    expect(cost.inputTokens).toBe(0);
    expect(cost.outputTokens).toBe(0);
  });
});
