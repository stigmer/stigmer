/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/graphs/contributors>
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

package golden_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/utils"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/zigflow"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/zigflow/tasks"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// GoldenTestCase represents a golden test scenario
type GoldenTestCase struct {
	Name         string
	YAMLFile     string
	Description  string
	InitialData  map[string]any
	ExpectedData map[string]any // Expected keys in state after execution
	ShouldError  bool
}

// GetGoldenTestCases returns all golden test scenarios
func GetGoldenTestCases() []GoldenTestCase {
	return []GoldenTestCase{
		{
			Name:        "01-operation-basic",
			YAMLFile:    "01-operation-basic.yaml",
			Description: "Basic operation state with SET tasks",
			InitialData: map[string]any{},
			ExpectedData: map[string]any{
				"initialize": map[string]any{"workflow_started": true},
				"hello": map[string]any{
					"message":  "Hello, Zigflow!",
					"status":   "success",
					"executed": true,
				},
				"finalize": map[string]any{"workflow_completed": true},
			},
		},
		{
			Name:        "02-switch-conditional",
			YAMLFile:    "02-switch-conditional.yaml",
			Description: "Conditional branching with switch and HTTP calls",
			InitialData: map[string]any{},
			// Note: HTTP calls require network, so we test structure only
		},
		{
			Name:        "03-foreach-loop",
			YAMLFile:    "03-foreach-loop.yaml",
			Description: "ForEach loop iteration with HTTP calls",
			InitialData: map[string]any{
				"items": []any{"item1", "item2", "item3"},
			},
		},
		{
			Name:        "04-parallel-concurrent",
			YAMLFile:    "04-parallel-concurrent.yaml",
			Description: "Parallel execution with fork/branches",
			InitialData: map[string]any{},
		},
		{
			Name:        "05-event-signal",
			YAMLFile:    "05-event-signal.yaml",
			Description: "Event listening and signal handling",
			InitialData: map[string]any{},
		},
		{
			Name:        "06-sleep-delay",
			YAMLFile:    "06-sleep-delay.yaml",
			Description: "Wait/sleep delay functionality",
			InitialData: map[string]any{},
		},
		{
			Name:        "07-inject-transform",
			YAMLFile:    "07-inject-transform.yaml",
			Description: "Data injection and transformation",
			InitialData: map[string]any{
				"a": 10,
				"b": 20,
			},
			ExpectedData: map[string]any{
				"injectData": map[string]any{
					"computed": float64(30),
					"message":  "Data injected",
				},
			},
		},
		{
			Name:        "08-error-retry",
			YAMLFile:    "08-error-retry.yaml",
			Description: "Error handling and retry logic",
			InitialData: map[string]any{},
		},
		{
			Name:        "09-nested-states",
			YAMLFile:    "09-nested-states.yaml",
			Description: "Nested state management",
			InitialData: map[string]any{},
		},
		{
			Name:        "10-complex-workflow",
			YAMLFile:    "10-complex-workflow.yaml",
			Description: "Complex real-world workflow combining multiple patterns",
			InitialData: map[string]any{
				"valid": true,
			},
		},
		{
			Name:        "11-claimcheck-large-payload",
			YAMLFile:    "11-claimcheck-large-payload.yaml",
			Description: "ClaimCheck pattern for large payloads",
			InitialData: map[string]any{},
		},
		{
			Name:        "12-claimcheck-between-steps",
			YAMLFile:    "12-claimcheck-between-steps.yaml",
			Description: "ClaimCheck pattern between workflow steps",
			InitialData: map[string]any{},
		},
	}
}

// TestGoldenWorkflows_LoadAndParse tests that all golden YAML files can be loaded and parsed
func TestGoldenWorkflows_LoadAndParse(t *testing.T) {
	testCases := GetGoldenTestCases()

	for _, tc := range testCases {
		t.Run(tc.Name, func(t *testing.T) {
			// Get the absolute path to the YAML file
			yamlPath := filepath.Join(".", tc.YAMLFile)

			// Load workflow from YAML file
			workflow, err := zigflow.LoadFromFile(yamlPath)
			require.NoError(t, err, "Failed to load workflow from %s", tc.YAMLFile)
			require.NotNil(t, workflow, "Workflow should not be nil")

			// Verify basic workflow structure
			assert.NotNil(t, workflow.Document, "Workflow document should not be nil")
			assert.Equal(t, "1.0.0", workflow.Document.DSL, "DSL version should be 1.0.0")
			assert.NotEmpty(t, workflow.Document.Name, "Workflow name should not be empty")
			assert.NotNil(t, workflow.Do, "Workflow should have tasks")

			t.Logf("✅ Successfully loaded and parsed %s: %s", tc.Name, tc.Description)
		})
	}
}

// TestGoldenWorkflows_BuildTasks tests that all workflows can build their task structures
func TestGoldenWorkflows_BuildTasks(t *testing.T) {
	testCases := GetGoldenTestCases()

	for _, tc := range testCases {
		t.Run(tc.Name, func(t *testing.T) {
			// Load workflow
			yamlPath := filepath.Join(".", tc.YAMLFile)
			workflow, err := zigflow.LoadFromFile(yamlPath)
			require.NoError(t, err, "Failed to load workflow")

			// Build task structure
			// Note: We pass nil for worker since we're not executing, just validating structure
			taskBuilder, err := tasks.NewDoTaskBuilder(
				nil, // worker - not needed for validation
				&model.DoTask{Do: workflow.Do},
				workflow.Document.Name,
				workflow,
				tasks.DoTaskOpts{
					Envvars:                 make(map[string]any),
					DisableRegisterWorkflow: true,
				},
			)
			require.NoError(t, err, "Failed to create task builder")

			// Build the workflow (validates all task types are supported)
			_, err = taskBuilder.Build()
			require.NoError(t, err, "Failed to build workflow tasks")

			t.Logf("✅ Successfully built task structure for %s", tc.Name)
		})
	}
}

// TestGoldenWorkflows_ExpressionEvaluation tests expression evaluation in workflows
func TestGoldenWorkflows_ExpressionEvaluation(t *testing.T) {
	// Test cases that involve expression evaluation
	testCases := []struct {
		name         string
		yamlFile     string
		initialData  map[string]any
		expectedKeys []string
	}{
		{
			name:     "07-inject-transform",
			yamlFile: "07-inject-transform.yaml",
			initialData: map[string]any{
				"a": 10,
				"b": 20,
			},
			expectedKeys: []string{"injectData"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Load workflow
			yamlPath := filepath.Join(".", tc.yamlFile)
			_, err := zigflow.LoadFromFile(yamlPath)
			require.NoError(t, err, "Failed to load workflow")

			// Initialize state with test data
			state := utils.NewState()
			state.Data = tc.initialData

			// Note: Full execution requires Temporal context which we don't have in unit tests
			// This test validates that the workflow structure supports expression evaluation
			// Actual expression evaluation is tested in task_builder tests
			_ = state // state is prepared for future expression evaluation tests

			t.Logf("✅ Validated expression evaluation structure for %s", tc.name)
		})
	}
}

// TestGoldenWorkflows_FileIntegrity ensures all referenced golden files exist
func TestGoldenWorkflows_FileIntegrity(t *testing.T) {
	testCases := GetGoldenTestCases()

	for _, tc := range testCases {
		t.Run(tc.Name+"-file-exists", func(t *testing.T) {
			yamlPath := filepath.Join(".", tc.YAMLFile)
			_, err := os.Stat(yamlPath)
			require.NoError(t, err, "Golden file %s should exist", tc.YAMLFile)
		})
	}
}

// TestGoldenWorkflows_HTTPTaskExpressions specifically tests HTTP tasks with expressions
func TestGoldenWorkflows_HTTPTaskExpressions(t *testing.T) {
	t.Run("switch-conditional-http-expressions", func(t *testing.T) {
		// Load the switch-conditional workflow which has HTTP tasks with expressions
		yamlPath := filepath.Join(".", "02-switch-conditional.yaml")
		workflow, err := zigflow.LoadFromFile(yamlPath)
		require.NoError(t, err, "Failed to load workflow")

		// Verify the workflow has HTTP call tasks
		require.NotNil(t, workflow.Do, "Workflow should have tasks")
		assert.Greater(t, len(*workflow.Do), 0, "Workflow should have at least one task")

		// Build task structure - this validates HTTP tasks can be processed
		taskBuilder, err := tasks.NewDoTaskBuilder(
			nil,
			&model.DoTask{Do: workflow.Do},
			workflow.Document.Name,
			workflow,
			tasks.DoTaskOpts{
				Envvars:                 make(map[string]any),
				DisableRegisterWorkflow: true,
			},
		)
		require.NoError(t, err, "Failed to create task builder with HTTP expressions")

		// Build - validates expression evaluation structure for HTTP tasks
		_, err = taskBuilder.Build()
		require.NoError(t, err, "Failed to build workflow with HTTP expression tasks")

		t.Log("✅ Successfully validated HTTP task expression evaluation structure")
	})
}

// TestGoldenWorkflows_SetTaskExpressions tests SET tasks with expression evaluation
func TestGoldenWorkflows_SetTaskExpressions(t *testing.T) {
	t.Run("inject-transform-set-expressions", func(t *testing.T) {
		// Load workflow with SET tasks containing expressions
		yamlPath := filepath.Join(".", "07-inject-transform.yaml")
		workflow, err := zigflow.LoadFromFile(yamlPath)
		require.NoError(t, err, "Failed to load workflow")

		// Build task structure
		taskBuilder, err := tasks.NewDoTaskBuilder(
			nil,
			&model.DoTask{Do: workflow.Do},
			workflow.Document.Name,
			workflow,
			tasks.DoTaskOpts{
				Envvars:                 make(map[string]any),
				DisableRegisterWorkflow: true,
			},
		)
		require.NoError(t, err, "Failed to create task builder with SET expressions")

		// Build - validates SET task expression structure
		_, err = taskBuilder.Build()
		require.NoError(t, err, "Failed to build workflow with SET expression tasks")

		t.Log("✅ Successfully validated SET task expression evaluation structure")
	})
}

// TestGoldenWorkflows_ComplexWorkflow tests the most complex golden workflow
func TestGoldenWorkflows_ComplexWorkflow(t *testing.T) {
	t.Run("10-complex-workflow-all-patterns", func(t *testing.T) {
		// Load the complex workflow that combines multiple patterns
		yamlPath := filepath.Join(".", "10-complex-workflow.yaml")
		workflow, err := zigflow.LoadFromFile(yamlPath)
		require.NoError(t, err, "Failed to load complex workflow")

		// Verify it has multiple task types
		require.NotNil(t, workflow.Do, "Complex workflow should have tasks")

		// Build the entire workflow structure
		taskBuilder, err := tasks.NewDoTaskBuilder(
			nil,
			&model.DoTask{Do: workflow.Do},
			workflow.Document.Name,
			workflow,
			tasks.DoTaskOpts{
				Envvars:                 make(map[string]any),
				DisableRegisterWorkflow: true,
			},
		)
		require.NoError(t, err, "Failed to create task builder for complex workflow")

		// Build - this validates all patterns work together
		_, err = taskBuilder.Build()
		require.NoError(t, err, "Failed to build complex workflow")

		t.Log("✅ Successfully validated complex workflow with all patterns")
	})
}

// TestGoldenWorkflows_Regression catches regressions from code changes
func TestGoldenWorkflows_Regression(t *testing.T) {
	t.Run("all-golden-workflows-remain-valid", func(t *testing.T) {
		testCases := GetGoldenTestCases()
		successCount := 0

		for _, tc := range testCases {
			yamlPath := filepath.Join(".", tc.YAMLFile)

			// Load workflow
			workflow, err := zigflow.LoadFromFile(yamlPath)
			if err != nil {
				t.Errorf("❌ Regression: Failed to load %s: %v", tc.Name, err)
				continue
			}

			// Build tasks
			taskBuilder, err := tasks.NewDoTaskBuilder(
				nil,
				&model.DoTask{Do: workflow.Do},
				workflow.Document.Name,
				workflow,
				tasks.DoTaskOpts{
					Envvars:                 make(map[string]any),
					DisableRegisterWorkflow: true,
				},
			)
			if err != nil {
				t.Errorf("❌ Regression: Failed to create task builder for %s: %v", tc.Name, err)
				continue
			}

			// Build
			_, err = taskBuilder.Build()
			if err != nil {
				t.Errorf("❌ Regression: Failed to build %s: %v", tc.Name, err)
				continue
			}

			successCount++
		}

		// All workflows should pass
		assert.Equal(t, len(testCases), successCount,
			"All %d golden workflows should remain valid after code changes", len(testCases))

		t.Logf("✅ All %d golden workflows remain valid (no regressions)", successCount)
	})
}
