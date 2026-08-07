package validation

import (
	"fmt"
	"math"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/converter"
)

// CheckBudgetWarnings detects budget misconfigurations that are not proto-level
// errors but likely authoring mistakes. Returns non-blocking warning strings.
func CheckBudgetWarnings(budget *workflowv1.WorkflowBudget, tasks []*workflowv1.WorkflowTask) []string {
	hasCostBearingTasks := false
	for _, task := range tasks {
		if task.Kind == workflowv1.WorkflowTaskKind_llm_call ||
			task.Kind == workflowv1.WorkflowTaskKind_agent_call {
			hasCostBearingTasks = true
			break
		}
	}

	if budget == nil {
		if hasCostBearingTasks {
			return []string{
				"Workflow contains cost-incurring tasks (agent_call, llm_call) but no budget limit is set. " +
					"Consider adding a budget to prevent unexpected costs.",
			}
		}
		return nil
	}

	var warnings []string
	hasLimits := budget.MaxCostMicros > 0 || budget.MaxTotalTokens > 0 || budget.MaxDurationSeconds > 0

	if budget.OnExceeded == workflowv1.BudgetExceededPolicy_budget_exceeded_terminate {
		if budget.MaxCostMicros == 0 {
			warnings = append(warnings,
				"Budget has zero max_cost_micros with terminate policy; workflow will fail immediately on first cost-bearing task")
		}
		if budget.MaxTotalTokens == 0 {
			warnings = append(warnings,
				"Budget has zero max_total_tokens with terminate policy; workflow will fail immediately on first cost-bearing task")
		}
	}

	if !hasCostBearingTasks && (budget.MaxCostMicros > 0 || budget.MaxTotalTokens > 0) {
		warnings = append(warnings,
			"Budget is configured but workflow contains no cost-bearing task kinds (llm_call, agent_call)")
	}

	if hasLimits && budget.OnExceeded == workflowv1.BudgetExceededPolicy_budget_exceeded_policy_unspecified {
		warnings = append(warnings,
			"Budget limits are set but on_exceeded policy is not specified; defaults to terminate")
	}

	if budget.MaxDurationSeconds > 0 && budget.MaxDurationSeconds < 10 {
		warnings = append(warnings,
			fmt.Sprintf("Budget duration of %d seconds may be too short for workflow execution",
				budget.MaxDurationSeconds))
	}

	if budget.MaxCostMicros > 0 {
		// Per-task caps are compared in micros. llm_call declares micros
		// natively; agent_call declares the shared RunConfig's max_cost_usd
		// (USD, double) and is converted here. Each entry carries its own
		// field label so the warning names the field the author actually set.
		type perTaskEntry struct {
			name        string
			costMicros  int64
			fieldLabel  string
		}
		var perTaskEntries []perTaskEntry

		for _, task := range tasks {
			switch task.Kind {
			case workflowv1.WorkflowTaskKind_llm_call:
				msg, err := converter.UnmarshalTaskConfigPublic(task.Kind, task.TaskConfig)
				if err != nil {
					continue
				}
				if cfg, ok := msg.(*tasksv1.LlmCallTaskConfig); ok && cfg.MaxCostMicros > 0 {
					perTaskEntries = append(perTaskEntries, perTaskEntry{
						name:       task.Name,
						costMicros: cfg.MaxCostMicros,
						fieldLabel: fmt.Sprintf("max_cost_micros (%d)", cfg.MaxCostMicros),
					})
				}

			case workflowv1.WorkflowTaskKind_agent_call:
				msg, err := converter.UnmarshalTaskConfigPublic(task.Kind, task.TaskConfig)
				if err != nil {
					continue
				}
				if cfg, ok := msg.(*tasksv1.AgentCallTaskConfig); ok && cfg.GetRunConfig().GetMaxCostUsd() > 0 {
					usd := cfg.GetRunConfig().GetMaxCostUsd()
					perTaskEntries = append(perTaskEntries, perTaskEntry{
						name:       task.Name,
						costMicros: usdToMicros(usd),
						fieldLabel: fmt.Sprintf("run_config.max_cost_usd ($%.2f)", usd),
					})
				}
			}
		}

		var perTaskCostSum int64
		for _, entry := range perTaskEntries {
			perTaskCostSum += entry.costMicros
			if entry.costMicros > budget.MaxCostMicros {
				warnings = append(warnings, fmt.Sprintf(
					"Task '%s' has %s that exceeds the workflow budget max_cost_micros (%d).",
					entry.name, entry.fieldLabel, budget.MaxCostMicros))
			}
		}

		if perTaskCostSum > budget.MaxCostMicros && len(perTaskEntries) > 1 {
			warnings = append(warnings, fmt.Sprintf(
				"Combined per-task cost limits ($%.2f) exceed the workflow budget ($%.2f). "+
					"Some tasks may be terminated before reaching their individual limits.",
				float64(perTaskCostSum)/1_000_000,
				float64(budget.MaxCostMicros)/1_000_000))
		}
	}

	return warnings
}

// usdToMicros converts a USD amount to micro-USD (1 USD = 1,000,000 micros),
// rounding to the nearest micro so float noise cannot skew budget comparisons.
func usdToMicros(usd float64) int64 {
	return int64(math.Round(usd * 1_000_000))
}
