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

	workflowv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresourcev1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/commons/apiresource"
	tasksv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestValidateSetTaskConfig(t *testing.T) {
	t.Run("valid config passes", func(t *testing.T) {
		config := &tasksv1.SetTaskConfig{
			Variables: map[string]string{
				"status": "initialized",
			},
		}

		err := ValidateTaskConfig(config)
		assert.NoError(t, err)
	})

	t.Run("missing required field fails", func(t *testing.T) {
		config := &tasksv1.SetTaskConfig{
			Variables: nil, // Required field missing
		}

		err := ValidateTaskConfig(config)
		assert.Error(t, err)
		
		// Check that it's a ValidationErrors
		valErrs, ok := err.(*ValidationErrors)
		require.True(t, ok, "expected ValidationErrors type")
		assert.Greater(t, len(valErrs.Errors), 0)
	})
}

func TestValidateHttpCallTaskConfig(t *testing.T) {
	t.Run("valid GET request passes", func(t *testing.T) {
		config := &tasksv1.HttpCallTaskConfig{
			Method: "GET",
			Endpoint: &tasksv1.HttpEndpoint{
				Uri: "https://api.example.com/data",
			},
			TimeoutSeconds: 30, // Set valid timeout (default 0 fails validation)
		}

		err := ValidateTaskConfig(config)
		assert.NoError(t, err)
	})

	t.Run("invalid HTTP method fails", func(t *testing.T) {
		config := &tasksv1.HttpCallTaskConfig{
			Method: "INVALID",
			Endpoint: &tasksv1.HttpEndpoint{
				Uri: "https://api.example.com/data",
			},
		}

		err := ValidateTaskConfig(config)
		assert.Error(t, err)
		
		valErrs, ok := err.(*ValidationErrors)
		require.True(t, ok, "expected ValidationErrors type")
		assert.Greater(t, len(valErrs.Errors), 0)
		
		// Check that the error mentions the method field
		assert.Contains(t, valErrs.Error(), "method")
	})

	t.Run("missing required endpoint fails", func(t *testing.T) {
		config := &tasksv1.HttpCallTaskConfig{
			Method:   "GET",
			Endpoint: nil, // Required field
		}

		err := ValidateTaskConfig(config)
		assert.Error(t, err)
	})

	t.Run("missing endpoint URI fails", func(t *testing.T) {
		config := &tasksv1.HttpCallTaskConfig{
			Method: "GET",
			Endpoint: &tasksv1.HttpEndpoint{
				Uri: "", // Required field
			},
		}

		err := ValidateTaskConfig(config)
		assert.Error(t, err)
	})

	t.Run("timeout within range passes", func(t *testing.T) {
		config := &tasksv1.HttpCallTaskConfig{
			Method: "GET",
			Endpoint: &tasksv1.HttpEndpoint{
				Uri: "https://api.example.com/data",
			},
			TimeoutSeconds: 30,
		}

		err := ValidateTaskConfig(config)
		assert.NoError(t, err)
	})

	t.Run("timeout out of range fails", func(t *testing.T) {
		config := &tasksv1.HttpCallTaskConfig{
			Method: "GET",
			Endpoint: &tasksv1.HttpEndpoint{
				Uri: "https://api.example.com/data",
			},
			TimeoutSeconds: 500, // Max is 300
		}

		err := ValidateTaskConfig(config)
		assert.Error(t, err)
	})
}

func TestValidateSwitchTaskConfig(t *testing.T) {
	t.Run("valid config with cases passes", func(t *testing.T) {
		config := &tasksv1.SwitchTaskConfig{
			Cases: []*tasksv1.SwitchCase{
				{
					Name: "case1",
					When: "${ .value > 100 }",
					Then: "handleHigh",
				},
			},
		}

		err := ValidateTaskConfig(config)
		assert.NoError(t, err)
	})

	t.Run("empty cases fails", func(t *testing.T) {
		config := &tasksv1.SwitchTaskConfig{
			Cases: []*tasksv1.SwitchCase{}, // Min 1 required
		}

		err := ValidateTaskConfig(config)
		assert.Error(t, err)
	})

	t.Run("case missing name fails", func(t *testing.T) {
		config := &tasksv1.SwitchTaskConfig{
			Cases: []*tasksv1.SwitchCase{
				{
					Name: "", // Required
					Then: "handleDefault",
				},
			},
		}

		err := ValidateTaskConfig(config)
		assert.Error(t, err)
	})

	t.Run("case missing then fails", func(t *testing.T) {
		config := &tasksv1.SwitchTaskConfig{
			Cases: []*tasksv1.SwitchCase{
				{
					Name: "case1",
					Then: "", // Required
				},
			},
		}

		err := ValidateTaskConfig(config)
		assert.Error(t, err)
	})
}

func TestValidateTask(t *testing.T) {
	t.Run("valid SET task passes", func(t *testing.T) {
		config, err := structpb.NewStruct(map[string]interface{}{
			"variables": map[string]interface{}{
				"status": "initialized",
			},
		})
		require.NoError(t, err)

		task := &workflowv1.WorkflowTask{
			Name:       "initializeTask",
			Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
			TaskConfig: config,
		}

		err = ValidateTask(task)
		assert.NoError(t, err)
	})

	t.Run("invalid HTTP task fails with context", func(t *testing.T) {
		config, err := structpb.NewStruct(map[string]interface{}{
			"method": "INVALID",
			"endpoint": map[string]interface{}{
				"uri": "https://api.example.com/data",
			},
		})
		require.NoError(t, err)

		task := &workflowv1.WorkflowTask{
			Name:       "fetchData",
			Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
			TaskConfig: config,
		}

		err = ValidateTask(task)
		assert.Error(t, err)
		
		// Check that error includes task name and kind
		assert.Contains(t, err.Error(), "fetchData")
		assert.Contains(t, err.Error(), "HTTP_CALL")
	})

	t.Run("nil task fails", func(t *testing.T) {
		err := ValidateTask(nil)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "task cannot be nil")
	})
}

func TestValidateWorkflow(t *testing.T) {
	t.Run("valid workflow with multiple tasks passes", func(t *testing.T) {
		setConfig, err := structpb.NewStruct(map[string]interface{}{
			"variables": map[string]interface{}{
				"status": "initialized",
			},
		})
		require.NoError(t, err)

		httpConfig, err := structpb.NewStruct(map[string]interface{}{
			"method": "GET",
			"endpoint": map[string]interface{}{
				"uri": "https://api.example.com/data",
			},
			"timeout_seconds": 30, // Set valid timeout
		})
		require.NoError(t, err)

		spec := &workflowv1.WorkflowSpec{
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test",
				Name:      "test-workflow",
				Version:   "1.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initialize",
					Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
					TaskConfig: setConfig,
				},
				{
					Name:       "fetchData",
					Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
					TaskConfig: httpConfig,
				},
			},
		}

		err = ValidateWorkflow(spec)
		assert.NoError(t, err)
	})

	t.Run("workflow with invalid task fails", func(t *testing.T) {
		invalidConfig, err := structpb.NewStruct(map[string]interface{}{
			"method": "INVALID",
			"endpoint": map[string]interface{}{
				"uri": "https://api.example.com/data",
			},
		})
		require.NoError(t, err)

		spec := &workflowv1.WorkflowSpec{
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test",
				Name:      "test-workflow",
				Version:   "1.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "fetchData",
					Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
					TaskConfig: invalidConfig,
				},
			},
		}

		err = ValidateWorkflow(spec)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "task 1 validation failed")
	})

	t.Run("workflow with no tasks fails", func(t *testing.T) {
		spec := &workflowv1.WorkflowSpec{
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test",
				Name:      "test-workflow",
				Version:   "1.0",
			},
			Tasks: []*workflowv1.WorkflowTask{},
		}

		err := ValidateWorkflow(spec)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "at least one task")
	})

	t.Run("nil workflow fails", func(t *testing.T) {
		err := ValidateWorkflow(nil)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "workflow spec cannot be nil")
	})
}
