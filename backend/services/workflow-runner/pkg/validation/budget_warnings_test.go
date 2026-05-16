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
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stretchr/testify/assert"
)

func TestCheckBudgetWarnings_NoBudget(t *testing.T) {
	tasks := []*workflowv1.WorkflowTask{
		{
			Name: "setVars",
			Kind: workflowv1.WorkflowTaskKind_set_vars,
			TaskConfig: mustStruct(t, map[string]interface{}{
				"variables": map[string]interface{}{"x": "1"},
			}),
		},
	}

	warnings := CheckBudgetWarnings(nil, tasks)
	assert.Empty(t, warnings, "nil budget with non-cost-bearing tasks should produce no warnings")
}

func TestCheckBudgetWarnings_NoBudgetWithCostBearingTasks(t *testing.T) {
	tasks := []*workflowv1.WorkflowTask{
		{
			Name: "callLLM",
			Kind: workflowv1.WorkflowTaskKind_llm_call,
			TaskConfig: mustStruct(t, map[string]interface{}{
				"model":  "gpt-4",
				"prompt": "hello",
			}),
		},
	}

	warnings := CheckBudgetWarnings(nil, tasks)
	assert.Len(t, warnings, 1)
	assert.Contains(t, warnings[0], "no budget limit is set")
}

func TestCheckBudgetWarnings_ZeroCostWithTerminate(t *testing.T) {
	budget := &workflowv1.WorkflowBudget{
		MaxCostMicros:  0,
		MaxTotalTokens: 0,
		OnExceeded:     workflowv1.BudgetExceededPolicy_budget_exceeded_terminate,
	}
	tasks := []*workflowv1.WorkflowTask{
		{
			Name: "callLLM",
			Kind: workflowv1.WorkflowTaskKind_llm_call,
			TaskConfig: mustStruct(t, map[string]interface{}{
				"model":  "gpt-4",
				"prompt": "hello",
			}),
		},
	}

	warnings := CheckBudgetWarnings(budget, tasks)
	assert.NotEmpty(t, warnings)

	hasMaxCostWarning := false
	for _, w := range warnings {
		if assert.ObjectsAreEqual("Budget has zero max_cost_micros with terminate policy; workflow will fail immediately on first cost-bearing task", w) {
			hasMaxCostWarning = true
		}
	}
	assert.True(t, hasMaxCostWarning, "should warn about zero max_cost_micros with terminate")
}

func TestCheckBudgetWarnings_NoCostBearingTasks(t *testing.T) {
	budget := &workflowv1.WorkflowBudget{
		MaxCostMicros:  5_000_000,
		MaxTotalTokens: 100_000,
		OnExceeded:     workflowv1.BudgetExceededPolicy_budget_exceeded_terminate,
	}
	tasks := []*workflowv1.WorkflowTask{
		{
			Name: "setVars",
			Kind: workflowv1.WorkflowTaskKind_set_vars,
			TaskConfig: mustStruct(t, map[string]interface{}{
				"variables": map[string]interface{}{"x": "1"},
			}),
		},
		{
			Name: "transform",
			Kind: workflowv1.WorkflowTaskKind_transform,
			TaskConfig: mustStruct(t, map[string]interface{}{
				"engine":     "jq",
				"expression": ".",
			}),
		},
	}

	warnings := CheckBudgetWarnings(budget, tasks)
	assert.NotEmpty(t, warnings)

	found := false
	for _, w := range warnings {
		if w == "Budget is configured but workflow contains no cost-bearing task kinds (llm_call, agent_call)" {
			found = true
		}
	}
	assert.True(t, found, "should warn about budget with no cost-bearing tasks")
}

func TestCheckBudgetWarnings_MissingPolicy(t *testing.T) {
	budget := &workflowv1.WorkflowBudget{
		MaxCostMicros:  5_000_000,
		MaxTotalTokens: 100_000,
		OnExceeded:     workflowv1.BudgetExceededPolicy_budget_exceeded_policy_unspecified,
	}
	tasks := []*workflowv1.WorkflowTask{
		{
			Name: "callLLM",
			Kind: workflowv1.WorkflowTaskKind_llm_call,
			TaskConfig: mustStruct(t, map[string]interface{}{
				"model":  "gpt-4",
				"prompt": "hello",
			}),
		},
	}

	warnings := CheckBudgetWarnings(budget, tasks)
	assert.NotEmpty(t, warnings)

	found := false
	for _, w := range warnings {
		if w == "Budget limits are set but on_exceeded policy is not specified; defaults to terminate" {
			found = true
		}
	}
	assert.True(t, found, "should warn about missing on_exceeded policy")
}

func TestCheckBudgetWarnings_LowDuration(t *testing.T) {
	budget := &workflowv1.WorkflowBudget{
		MaxDurationSeconds: 5,
		OnExceeded:         workflowv1.BudgetExceededPolicy_budget_exceeded_terminate,
	}
	tasks := []*workflowv1.WorkflowTask{
		{
			Name: "setVars",
			Kind: workflowv1.WorkflowTaskKind_set_vars,
			TaskConfig: mustStruct(t, map[string]interface{}{
				"variables": map[string]interface{}{"x": "1"},
			}),
		},
	}

	warnings := CheckBudgetWarnings(budget, tasks)
	assert.NotEmpty(t, warnings)

	found := false
	for _, w := range warnings {
		if w == "Budget duration of 5 seconds may be too short for workflow execution" {
			found = true
		}
	}
	assert.True(t, found, "should warn about low duration budget")
}

func TestCheckBudgetWarnings_ValidBudget(t *testing.T) {
	budget := &workflowv1.WorkflowBudget{
		MaxCostMicros:      5_000_000,
		MaxTotalTokens:     500_000,
		MaxDurationSeconds: 3600,
		OnExceeded:         workflowv1.BudgetExceededPolicy_budget_exceeded_terminate,
	}
	tasks := []*workflowv1.WorkflowTask{
		{
			Name: "callLLM",
			Kind: workflowv1.WorkflowTaskKind_llm_call,
			TaskConfig: mustStruct(t, map[string]interface{}{
				"model":  "gpt-4",
				"prompt": "hello",
			}),
		},
	}

	warnings := CheckBudgetWarnings(budget, tasks)
	assert.Empty(t, warnings, "well-configured budget should produce no warnings")
}

func TestCheckBudgetWarnings_NilBudgetNilTasks(t *testing.T) {
	warnings := CheckBudgetWarnings(nil, nil)
	assert.Nil(t, warnings)
}

func TestCheckBudgetWarnings_EmptyTasks(t *testing.T) {
	warnings := CheckBudgetWarnings(nil, []*workflowv1.WorkflowTask{})
	assert.Nil(t, warnings)
}

