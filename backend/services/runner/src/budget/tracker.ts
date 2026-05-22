/**
 * Budget tracker — accumulates cost, token, and duration usage against
 * workflow-level budget limits.
 *
 * Port of Go's `pkg/budget/tracker.go`. The tracker is a pure, sandbox-safe
 * class with zero external dependencies — it can run inside the Temporal
 * deterministic isolate without importing Node.js or Temporal APIs.
 *
 * Budget config arrives via TemporalWorkflowInput (outside YAML) because
 * budget is a Stigmer extension that doesn't survive YAML round-trip.
 */

export type LimitKind = "cost" | "tokens" | "duration";

export type BudgetExceededPolicy = "terminate" | "warn" | "human_review";

export interface WorkflowBudget {
  readonly maxCostMicros?: number;
  readonly maxTotalTokens?: number;
  readonly maxDurationSeconds?: number;
  readonly onExceeded?: BudgetExceededPolicy;
}

export interface CheckResult {
  readonly ok: boolean;
  readonly warningPct: number;
  readonly exceeded: boolean;
  readonly exceededLimit?: LimitKind;
  readonly exceededMessage?: string;
  readonly policy: BudgetExceededPolicy;
}

export class BudgetTracker {
  private readonly budget: WorkflowBudget | undefined;
  private readonly startedAtMs: number;

  costMicros = 0;
  inputTokens = 0;
  outputTokens = 0;

  constructor(budget: WorkflowBudget | undefined, startedAtMs: number) {
    this.budget = budget;
    this.startedAtMs = startedAtMs;
  }

  record(costMicros: number, inputTokens: number, outputTokens: number): void {
    this.costMicros += costMicros;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
  }

  totalTokens(): number {
    return this.inputTokens + this.outputTokens;
  }

  check(nowMs: number): CheckResult {
    const policy = this.resolvePolicy();

    if (!this.budget) {
      return { ok: true, warningPct: 0, exceeded: false, policy };
    }

    let highestPct = 0;

    if (this.budget.maxCostMicros && this.budget.maxCostMicros > 0) {
      const pct = this.costMicros / this.budget.maxCostMicros;
      if (pct > highestPct) highestPct = pct;
      if (this.costMicros > this.budget.maxCostMicros) {
        return {
          ok: false,
          warningPct: pct,
          exceeded: true,
          exceededLimit: "cost",
          exceededMessage: `cost budget exceeded: ${this.costMicros}/${this.budget.maxCostMicros} micro-USD`,
          policy,
        };
      }
    }

    if (this.budget.maxTotalTokens && this.budget.maxTotalTokens > 0) {
      const total = this.totalTokens();
      const pct = total / this.budget.maxTotalTokens;
      if (pct > highestPct) highestPct = pct;
      if (total > this.budget.maxTotalTokens) {
        return {
          ok: false,
          warningPct: pct,
          exceeded: true,
          exceededLimit: "tokens",
          exceededMessage: `token budget exceeded: ${total}/${this.budget.maxTotalTokens} tokens`,
          policy,
        };
      }
    }

    if (this.budget.maxDurationSeconds && this.budget.maxDurationSeconds > 0) {
      const elapsedMs = nowMs - this.startedAtMs;
      const maxMs = this.budget.maxDurationSeconds * 1000;
      const pct = elapsedMs / maxMs;
      if (pct > highestPct) highestPct = pct;
      if (elapsedMs > maxMs) {
        const elapsedSec = Math.round(elapsedMs / 1000);
        return {
          ok: false,
          warningPct: pct,
          exceeded: true,
          exceededLimit: "duration",
          exceededMessage: `duration budget exceeded: ${elapsedSec}s/${this.budget.maxDurationSeconds}s`,
          policy,
        };
      }
    }

    return { ok: true, warningPct: highestPct, exceeded: false, policy };
  }

  costRemaining(): number {
    if (!this.budget?.maxCostMicros) return -1;
    const rem = this.budget.maxCostMicros - this.costMicros;
    return rem < 0 ? 0 : rem;
  }

  tokensRemaining(): number {
    if (!this.budget?.maxTotalTokens) return -1;
    const rem = this.budget.maxTotalTokens - this.totalTokens();
    return rem < 0 ? 0 : rem;
  }

  private resolvePolicy(): BudgetExceededPolicy {
    return this.budget?.onExceeded ?? "terminate";
  }
}

/**
 * Extracts cost metadata from task output using the __stigmer_* convention.
 * Activity outputs that contain LLM cost data should include these keys
 * for the budget tracker to accumulate.
 */
export interface TaskCostInfo {
  readonly costMicros: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export function extractCostFromOutput(output: unknown): TaskCostInfo {
  if (output === null || output === undefined || typeof output !== "object") {
    return { costMicros: 0, inputTokens: 0, outputTokens: 0 };
  }

  const o = output as Record<string, unknown>;

  return {
    costMicros: toSafeInt(o.__stigmer_cost_micros ?? o.cost_micros),
    inputTokens: toSafeInt(o.__stigmer_input_tokens ?? o.input_tokens),
    outputTokens: toSafeInt(o.__stigmer_output_tokens ?? o.output_tokens),
  };
}

function toSafeInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  return 0;
}
