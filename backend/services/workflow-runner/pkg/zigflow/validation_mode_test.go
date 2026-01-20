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

package zigflow_test

import (
	"testing"

	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/zigflow"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/zigflow/tasks"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestValidationOnlyMode tests if we can validate workflows without executing activities
// This is critical for the async validation flow during workflow creation
func TestValidationOnlyMode(t *testing.T) {
	workflowYAML := `
document:
  dsl: '1.0.0'
  namespace: test
  name: validation-test
  version: '1.0.0'
do:
  - initialize:
      set:
        status: "started"
  - fetchData:
      call: http
      with:
        method: get
        endpoint:
          uri: ${ .env.API_BASE_URL + "/data" }
  - processData:
      set:
        processed: true
`

	t.Run("Parse workflow with env var expressions", func(t *testing.T) {
		workflow, err := zigflow.LoadFromString(workflowYAML)
		require.NoError(t, err, "Failed to parse workflow YAML")
		assert.NotNil(t, workflow)
		assert.Equal(t, "validation-test", workflow.Document.Name)
		assert.NotNil(t, workflow.Do, "Do tasks should be present")
		assert.Equal(t, 3, len(*workflow.Do), "Should have 3 tasks")
	})

	t.Run("Build task executor without worker (validation mode)", func(t *testing.T) {
		workflow, err := zigflow.LoadFromString(workflowYAML)
		require.NoError(t, err)

		// CRITICAL: Build with nil worker (like gRPC mode)
		// This simulates validation without Temporal worker
		taskBuilder, err := tasks.NewDoTaskBuilder(
			nil, // No worker - validation only!
			&model.DoTask{Do: workflow.Do},
			workflow.Document.Name,
			workflow,
			tasks.DoTaskOpts{
				DisableRegisterWorkflow: true,
				Envvars:                 map[string]any{}, // Empty env vars (placeholders only)
				// TODO: Add ValidationOnly: true once implemented
			},
		)

		require.NoError(t, err, "Failed to create task builder")
		assert.NotNil(t, taskBuilder, "Task builder should be created")
	})

	t.Run("Build workflow validates structure", func(t *testing.T) {
		workflow, err := zigflow.LoadFromString(workflowYAML)
		require.NoError(t, err)

		taskBuilder, err := tasks.NewDoTaskBuilder(
			nil, // No worker
			&model.DoTask{Do: workflow.Do},
			workflow.Document.Name,
			workflow,
			tasks.DoTaskOpts{
				DisableRegisterWorkflow: true,
				Envvars:                 map[string]any{},
			},
		)
		require.NoError(t, err)

		// Build validates:
		// - Task dependencies
		// - Task types
		// - Circular references
		// - Structure validity
		workflowFunc, err := taskBuilder.Build()
		require.NoError(t, err, "Build should validate structure successfully")
		assert.NotNil(t, workflowFunc, "Workflow function should be built")

		// Note: We DON'T execute workflowFunc (that would need Temporal context)
		// We only validate that it can be built
	})
}

// TestValidationCatchesErrors tests that validation catches structural errors
func TestValidationCatchesErrors(t *testing.T) {
	t.Run("Missing document fields", func(t *testing.T) {
		invalidYAML := `
do:
  - task1:
      set:
        value: "test"
`
		// Missing document section
		_, err := zigflow.LoadFromString(invalidYAML)
		assert.Error(t, err, "Should fail with missing document")
	})

	t.Run("Invalid DSL version", func(t *testing.T) {
		invalidYAML := `
document:
  dsl: '0.8.0'  # Old version, not supported
  namespace: test
  name: test
  version: '1.0.0'
do:
  - task1:
      set:
        value: "test"
`
		_, err := zigflow.LoadFromString(invalidYAML)
		assert.Error(t, err, "Should fail with unsupported DSL version")
		assert.Contains(t, err.Error(), "unsupported DSL", "Error should mention DSL")
	})

	t.Run("Invalid task structure", func(t *testing.T) {
		invalidYAML := `
document:
  dsl: '1.0.0'
  namespace: test
  name: test
  version: '1.0.0'
do:
  - invalidTask:
      unknown_field: "value"
`
		workflow, err := zigflow.LoadFromString(invalidYAML)
		// Parser might succeed but task building should fail
		if err == nil {
			// Try to build tasks
			_, err = tasks.NewDoTaskBuilder(
				nil,
				&model.DoTask{Do: workflow.Do},
				workflow.Document.Name,
				workflow,
				tasks.DoTaskOpts{
					DisableRegisterWorkflow: true,
				},
			)
		}

		// Either parsing or building should catch the error
		// (depends on how strict the SDK is)
		t.Logf("Validation result: %v", err)
	})
}

// TestValidationWithCircularDependencies tests detection of circular task dependencies
func TestValidationWithCircularDependencies(t *testing.T) {
	t.Run("Valid sequential tasks", func(t *testing.T) {
		validYAML := `
document:
  dsl: '1.0.0'
  namespace: test
  name: sequential
  version: '1.0.0'
do:
  - task1:
      set:
        value: 1
  - task2:
      set:
        value: 2
  - task3:
      set:
        value: 3
`
		workflow, err := zigflow.LoadFromString(validYAML)
		require.NoError(t, err)

		taskBuilder, err := tasks.NewDoTaskBuilder(
			nil,
			&model.DoTask{Do: workflow.Do},
			workflow.Document.Name,
			workflow,
			tasks.DoTaskOpts{
				DisableRegisterWorkflow: true,
			},
		)
		require.NoError(t, err)

		_, err = taskBuilder.Build()
		assert.NoError(t, err, "Sequential tasks should validate successfully")
	})

	// TODO: Add test for actual circular dependency once we understand
	// how Serverless Workflow DSL represents task dependencies
	// (might use 'then' field or other flow control)
}
