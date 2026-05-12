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

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestValidateCrossTaskReferences_ValidReferences(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name: "classify",
				Kind: workflowv1.WorkflowTaskKind_llm_call,
				TaskConfig: mustStruct(t, map[string]interface{}{
					"model":        "gpt-4o-mini",
					"prompt":       "Classify this",
					"fallbackTask": "human_review",
				}),
			},
			{
				Name: "human_review",
				Kind: workflowv1.WorkflowTaskKind_human_input,
				TaskConfig: mustStruct(t, map[string]interface{}{
					"prompt": "Please review",
				}),
			},
		},
	}

	err := ValidateCrossTaskReferences(spec)
	assert.NoError(t, err)
}

func TestValidateCrossTaskReferences_InvalidFallbackTask(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name: "classify",
				Kind: workflowv1.WorkflowTaskKind_llm_call,
				TaskConfig: mustStruct(t, map[string]interface{}{
					"model":        "gpt-4o-mini",
					"prompt":       "Classify this",
					"fallbackTask": "human_reveiw",
				}),
			},
			{
				Name: "human_review",
				Kind: workflowv1.WorkflowTaskKind_human_input,
				TaskConfig: mustStruct(t, map[string]interface{}{
					"prompt": "Please review",
				}),
			},
		},
	}

	err := ValidateCrossTaskReferences(spec)
	require.Error(t, err)

	valErrs, ok := err.(*ValidationErrors)
	require.True(t, ok, "expected *ValidationErrors, got %T", err)
	require.Len(t, valErrs.Errors, 1)

	ve := valErrs.Errors[0]
	assert.Equal(t, "classify", ve.TaskName)
	assert.Equal(t, "fallback_task", ve.FieldPath)
	assert.Contains(t, ve.Message, "human_reveiw")
	assert.Contains(t, ve.Message, "did you mean 'human_review'")
}

func TestValidateCrossTaskReferences_InvalidSwitchCaseThen(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name: "route",
				Kind: workflowv1.WorkflowTaskKind_switch_case,
				TaskConfig: mustStruct(t, map[string]interface{}{
					"cases": []interface{}{
						map[string]interface{}{
							"name": "critical",
							"when": "${ true }",
							"then": "nonexistent_task",
						},
					},
				}),
			},
			{
				Name: "handle_critical",
				Kind: workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: mustStruct(t, map[string]interface{}{
					"variables": map[string]interface{}{"status": "handled"},
				}),
			},
		},
	}

	err := ValidateCrossTaskReferences(spec)
	require.Error(t, err)

	valErrs, ok := err.(*ValidationErrors)
	require.True(t, ok)
	require.Len(t, valErrs.Errors, 1)
	assert.Equal(t, "route", valErrs.Errors[0].TaskName)
	assert.Equal(t, "cases[0].then", valErrs.Errors[0].FieldPath)
	assert.Contains(t, valErrs.Errors[0].Message, "nonexistent_task")
}

func TestValidateCrossTaskReferences_NilSpec(t *testing.T) {
	assert.NoError(t, ValidateCrossTaskReferences(nil))
}

func TestValidateCrossTaskReferences_EmptyTasks(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{Tasks: nil}
	assert.NoError(t, ValidateCrossTaskReferences(spec))
}

func TestSuggestSimilar(t *testing.T) {
	names := map[string]bool{
		"human_review":    true,
		"classify":        true,
		"notify_team":     true,
		"escalate":        true,
	}

	assert.Equal(t, "human_review", suggestSimilar("human_reveiw", names))
	assert.Equal(t, "classify", suggestSimilar("clasify", names))
	assert.Equal(t, "", suggestSimilar("completely_different_name", names))
}

func TestLevenshtein(t *testing.T) {
	assert.Equal(t, 0, levenshtein("abc", "abc"))
	assert.Equal(t, 1, levenshtein("abc", "ab"))
	assert.Equal(t, 1, levenshtein("abc", "abd"))
	assert.Equal(t, 3, levenshtein("abc", "xyz"))
	assert.Equal(t, 2, levenshtein("review", "reveiw"))
}

func mustStruct(t *testing.T, m map[string]interface{}) *structpb.Struct {
	t.Helper()
	s, err := structpb.NewStruct(m)
	require.NoError(t, err)
	return s
}
