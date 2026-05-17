/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package validation

import (
	"fmt"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
)

// CheckBudgetWarnings performs semantic analysis on a workflow's budget
// configuration to detect misconfigurations that are not proto-level errors
// but likely indicate authoring mistakes.
//
// The function is pure: no side effects, no external dependencies.
//
// Returns a list of human-readable warning strings suitable for inclusion in
// ServerlessWorkflowValidation.warnings.
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

	// 1. Zero budget with terminate policy: the user configured a budget
	//    block and set terminate, but left cost/token limits at zero.
	//    Depending on runtime interpretation of zero, the workflow may
	//    either be unguarded or fail on the first cost-bearing task.
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

	// 2. Budget configured but no tasks incur costs.
	if !hasCostBearingTasks && (budget.MaxCostMicros > 0 || budget.MaxTotalTokens > 0) {
		warnings = append(warnings,
			"Budget is configured but workflow contains no cost-bearing task kinds (llm_call, agent_call)")
	}

	// 3. Budget limits set without an explicit on_exceeded policy.
	if hasLimits && budget.OnExceeded == workflowv1.BudgetExceededPolicy_budget_exceeded_policy_unspecified {
		warnings = append(warnings,
			"Budget limits are set but on_exceeded policy is not specified; defaults to terminate")
	}

	// 4. Duration budget extremely low.
	if budget.MaxDurationSeconds > 0 && budget.MaxDurationSeconds < 10 {
		warnings = append(warnings,
			fmt.Sprintf("Budget duration of %d seconds may be too short for workflow execution",
				budget.MaxDurationSeconds))
	}

	// 5. Per-task cost caps vs. workflow budget coherence.
	if budget.MaxCostMicros > 0 {
		var perTaskCostSum int64
		var perTaskEntries []struct {
			name string
			cost int64
		}

		for _, task := range tasks {
			switch task.Kind {
			case workflowv1.WorkflowTaskKind_llm_call:
				msg, err := UnmarshalTaskConfig(task.Kind, task.TaskConfig)
				if err != nil {
					continue
				}
				if cfg, ok := msg.(*tasksv1.LlmCallTaskConfig); ok && cfg.MaxCostMicros > 0 {
					perTaskCostSum += cfg.MaxCostMicros
					perTaskEntries = append(perTaskEntries, struct {
						name string
						cost int64
					}{task.Name, cfg.MaxCostMicros})
				}

			case workflowv1.WorkflowTaskKind_agent_call:
				msg, err := UnmarshalTaskConfig(task.Kind, task.TaskConfig)
				if err != nil {
					continue
				}
				if cfg, ok := msg.(*tasksv1.AgentCallTaskConfig); ok && cfg.Config != nil && cfg.Config.MaxCostMicros > 0 {
					perTaskCostSum += cfg.Config.MaxCostMicros
					perTaskEntries = append(perTaskEntries, struct {
						name string
						cost int64
					}{task.Name, cfg.Config.MaxCostMicros})
				}
			}
		}

		for _, entry := range perTaskEntries {
			if entry.cost > budget.MaxCostMicros {
				warnings = append(warnings, fmt.Sprintf(
					"Task '%s' has max_cost_micros (%d) that exceeds the workflow budget max_cost_micros (%d).",
					entry.name, entry.cost, budget.MaxCostMicros))
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
