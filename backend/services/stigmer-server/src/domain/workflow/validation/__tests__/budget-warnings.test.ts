/**
 * Budget-warning tests — pin the Go budget_warnings.go strings: the
 * no-budget nudge, zero-limit terminate traps, no-cost-task mismatch,
 * unspecified-policy default, too-short duration, per-task caps exceeding
 * the workflow budget (micros native and USD-converted labels), and the
 * combined-caps warning.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject, MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  BudgetExceededPolicy,
  WorkflowTaskKind,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import {
  WorkflowBudgetSchema,
  WorkflowSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import type { WorkflowBudget, WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import { checkBudgetWarnings } from "../budget-warnings.js";

function tasks(
  entries: Array<{ name: string; kind: WorkflowTaskKind; taskConfig?: JsonObject }>,
): WorkflowTask[] {
  return create(WorkflowSpecSchema, {
    document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
    tasks: entries,
  }).tasks;
}

function budget(
  fields: MessageInitShape<typeof WorkflowBudgetSchema>,
): WorkflowBudget {
  return create(WorkflowBudgetSchema, fields);
}

const LLM = (name: string, extra: JsonObject = {}) => ({
  name,
  kind: WorkflowTaskKind.llm_call,
  taskConfig: { model: "m", prompt: "p", ...extra } as JsonObject,
});
const SET = { name: "s", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: { k: "v" } } as JsonObject };

describe("checkBudgetWarnings", () => {
  it("nudges when cost-bearing tasks run without a budget", () => {
    expect(checkBudgetWarnings(undefined, tasks([LLM("l")]))).toEqual([
      "Workflow contains cost-incurring tasks (agent_call, llm_call) but no budget limit is set. " +
        "Consider adding a budget to prevent unexpected costs.",
    ]);
    expect(checkBudgetWarnings(undefined, tasks([SET]))).toEqual([]);
  });

  it("flags zero limits under the terminate policy", () => {
    const warnings = checkBudgetWarnings(
      budget({ onExceeded: BudgetExceededPolicy.budget_exceeded_terminate }),
      tasks([LLM("l")]),
    );
    expect(warnings).toContain(
      "Budget has zero max_cost_micros with terminate policy; workflow will fail immediately on first cost-bearing task",
    );
    expect(warnings).toContain(
      "Budget has zero max_total_tokens with terminate policy; workflow will fail immediately on first cost-bearing task",
    );
  });

  it("flags a funded budget over a workflow with no cost-bearing tasks", () => {
    expect(
      checkBudgetWarnings(budget({ maxCostMicros: 1000n }), tasks([SET])),
    ).toContain(
      "Budget is configured but workflow contains no cost-bearing task kinds (llm_call, agent_call)",
    );
  });

  it("flags limits without a policy, and a too-short duration", () => {
    const warnings = checkBudgetWarnings(
      budget({ maxCostMicros: 1000n, maxDurationSeconds: 5 }),
      tasks([LLM("l")]),
    );
    expect(warnings).toContain(
      "Budget limits are set but on_exceeded policy is not specified; defaults to terminate",
    );
    expect(warnings).toContain(
      "Budget duration of 5 seconds may be too short for workflow execution",
    );
  });

  it("compares per-task caps in micros with field-accurate labels and sums them", () => {
    const warnings = checkBudgetWarnings(
      budget({
        maxCostMicros: 3_000_000n,
        onExceeded: BudgetExceededPolicy.budget_exceeded_terminate,
        maxTotalTokens: 1n,
      }),
      tasks([
        LLM("cheap", { max_cost_micros: "2000000" }),
        LLM("pricey", { max_cost_micros: "4000000" }),
        {
          name: "agentic",
          kind: WorkflowTaskKind.agent_call,
          taskConfig: {
            agent: "a",
            message: "m",
            run_config: { max_cost_usd: 3.5 },
          },
        },
      ]),
    );
    expect(warnings).toContain(
      "Task 'pricey' has max_cost_micros (4000000) that exceeds the workflow budget max_cost_micros (3000000).",
    );
    expect(warnings).toContain(
      "Task 'agentic' has run_config.max_cost_usd ($3.50) that exceeds the workflow budget max_cost_micros (3000000).",
    );
    expect(warnings).toContain(
      "Combined per-task cost limits ($9.50) exceed the workflow budget ($3.00). " +
        "Some tasks may be terminated before reaching their individual limits.",
    );
  });

  it("renders exact-tie dollar amounts with Go's %.2f half-to-even rounding", () => {
    // 0.125 is binary-exact: Go %.2f prints $0.12 (ties to even);
    // toFixed(2) would print $0.13 (panel finding).
    const warnings = checkBudgetWarnings(
      budget({
        maxCostMicros: 1n,
        onExceeded: BudgetExceededPolicy.budget_exceeded_terminate,
        maxTotalTokens: 1n,
      }),
      tasks([
        {
          name: "tied",
          kind: WorkflowTaskKind.agent_call,
          taskConfig: { agent: "a", message: "m", run_config: { max_cost_usd: 0.125 } },
        },
      ]),
    );
    expect(warnings).toContain(
      "Task 'tied' has run_config.max_cost_usd ($0.12) that exceeds the workflow budget max_cost_micros (1).",
    );
  });
});
