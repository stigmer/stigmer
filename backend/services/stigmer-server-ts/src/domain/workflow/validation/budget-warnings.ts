/**
 * Budget misconfiguration warnings — ports
 * pkg/domain/workflow/validation/budget_warnings.go. Detects budget shapes
 * that are not proto-level errors but likely authoring mistakes; every
 * string is a non-blocking warning. Keep the strings in lockstep with the
 * cloud Java validator.
 */
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { BudgetExceededPolicy } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type {
  WorkflowBudget,
  WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import type { AgentCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import type { LlmCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/llm_call_pb";

import { tryUnmarshalTaskConfig } from "../converter/unmarshal.js";

/**
 * Go renders dollar amounts with %.2f — correct decimal rounding with ties
 * to EVEN — where toFixed(2) rounds ties away from zero: max_cost_usd
 * 0.125 must print $0.12 on both editions (panel finding). Intl's halfEven
 * mode matches Go's semantics on the same float64.
 */
const GO_2DP = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
  // Supported since Node 19; the compiler's lib types lag the runtime.
  roundingMode: "halfEven",
} as Intl.NumberFormatOptions);

export function checkBudgetWarnings(
  budget: WorkflowBudget | undefined,
  tasks: WorkflowTask[],
): string[] {
  const hasCostBearingTasks = tasks.some(
    (task) =>
      task.kind === WorkflowTaskKind.llm_call ||
      task.kind === WorkflowTaskKind.agent_call,
  );

  if (budget === undefined) {
    if (hasCostBearingTasks) {
      return [
        "Workflow contains cost-incurring tasks (agent_call, llm_call) but no budget limit is set. " +
          "Consider adding a budget to prevent unexpected costs.",
      ];
    }
    return [];
  }

  const warnings: string[] = [];
  const hasLimits =
    budget.maxCostMicros > 0n ||
    budget.maxTotalTokens > 0n ||
    budget.maxDurationSeconds > 0;

  if (budget.onExceeded === BudgetExceededPolicy.budget_exceeded_terminate) {
    if (budget.maxCostMicros === 0n) {
      warnings.push(
        "Budget has zero max_cost_micros with terminate policy; workflow will fail immediately on first cost-bearing task",
      );
    }
    if (budget.maxTotalTokens === 0n) {
      warnings.push(
        "Budget has zero max_total_tokens with terminate policy; workflow will fail immediately on first cost-bearing task",
      );
    }
  }

  if (!hasCostBearingTasks && (budget.maxCostMicros > 0n || budget.maxTotalTokens > 0n)) {
    warnings.push(
      "Budget is configured but workflow contains no cost-bearing task kinds (llm_call, agent_call)",
    );
  }

  if (
    hasLimits &&
    budget.onExceeded === BudgetExceededPolicy.budget_exceeded_policy_unspecified
  ) {
    warnings.push(
      "Budget limits are set but on_exceeded policy is not specified; defaults to terminate",
    );
  }

  if (budget.maxDurationSeconds > 0 && budget.maxDurationSeconds < 10) {
    warnings.push(
      `Budget duration of ${budget.maxDurationSeconds} seconds may be too short for workflow execution`,
    );
  }

  if (budget.maxCostMicros > 0n) {
    // Per-task caps are compared in micros. llm_call declares micros
    // natively; agent_call declares the shared RunConfig's max_cost_usd
    // (USD, double) and is converted here. Each entry carries its own
    // field label so the warning names the field the author actually set.
    interface PerTaskEntry {
      name: string;
      costMicros: number;
      fieldLabel: string;
    }
    const perTaskEntries: PerTaskEntry[] = [];

    for (const task of tasks) {
      switch (task.kind) {
        case WorkflowTaskKind.llm_call: {
          const cfg = tryUnmarshalTaskConfig<LlmCallTaskConfig>(task.kind, task.taskConfig);
          if (cfg !== undefined && cfg.maxCostMicros > 0n) {
            perTaskEntries.push({
              name: task.name,
              costMicros: Number(cfg.maxCostMicros),
              fieldLabel: `max_cost_micros (${cfg.maxCostMicros})`,
            });
          }
          break;
        }

        case WorkflowTaskKind.agent_call: {
          const cfg = tryUnmarshalTaskConfig<AgentCallTaskConfig>(task.kind, task.taskConfig);
          const usd = cfg?.runConfig?.maxCostUsd ?? 0;
          if (usd > 0) {
            perTaskEntries.push({
              name: task.name,
              costMicros: usdToMicros(usd),
              fieldLabel: `run_config.max_cost_usd ($${GO_2DP.format(usd)})`,
            });
          }
          break;
        }
      }
    }

    const budgetMicros = Number(budget.maxCostMicros);
    let perTaskCostSum = 0;
    for (const entry of perTaskEntries) {
      perTaskCostSum += entry.costMicros;
      if (entry.costMicros > budgetMicros) {
        warnings.push(
          `Task '${entry.name}' has ${entry.fieldLabel} that exceeds the workflow budget max_cost_micros (${budget.maxCostMicros}).`,
        );
      }
    }

    if (perTaskCostSum > budgetMicros && perTaskEntries.length > 1) {
      warnings.push(
        `Combined per-task cost limits ($${GO_2DP.format(perTaskCostSum / 1_000_000)}) exceed the workflow budget ($${GO_2DP.format(budgetMicros / 1_000_000)}). ` +
          "Some tasks may be terminated before reaching their individual limits.",
      );
    }
  }

  return warnings;
}

/**
 * Converts a USD amount to micro-USD (1 USD = 1,000,000 micros), rounding
 * to the nearest micro so float noise cannot skew budget comparisons.
 */
function usdToMicros(usd: number): number {
  return Math.round(usd * 1_000_000);
}
