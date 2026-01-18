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

package converter

import (
	"testing"

	workflowv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	apiresourcev1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/validation"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Phase 3 refactoring: Tests now use typed proto construction instead of raw Structs.
//
// Before: TaskConfig: &structpb.Struct{ Fields: map[string]*structpb.Value{...} }
// After: Build typed proto → Marshal to Struct using validation.MarshalTaskConfig

func TestProtoToYAML_SimpleSetTask(t *testing.T) {
	// Create typed proto
	setConfig := &tasksv1.SetTaskConfig{
		Variables: map[string]string{
			"status": "initialized",
		},
	}

	// Marshal to Struct
	taskConfig, err := validation.MarshalTaskConfig(setConfig)
	require.NoError(t, err)

	// Create workflow spec
	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "simple-workflow",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "set-status",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
				TaskConfig: taskConfig,
			},
		},
	}

	converter := NewConverter()
	yaml, err := converter.ProtoToYAML(spec)
	require.NoError(t, err)

	// Verify YAML contains expected elements
	assert.Contains(t, yaml, "document:")
	assert.Contains(t, yaml, "dsl: 1.0.0")
	assert.Contains(t, yaml, "namespace: test")
	assert.Contains(t, yaml, "name: simple-workflow")
	assert.Contains(t, yaml, "do:")
	assert.Contains(t, yaml, "set-status:")

	t.Logf("Generated YAML:\n%s", yaml)
}

func TestProtoToYAML_HTTPCallTask(t *testing.T) {
	// Create typed proto
	httpConfig := &tasksv1.HttpCallTaskConfig{
		Method: "GET",
		Endpoint: &tasksv1.HttpEndpoint{
			Uri: "https://api.example.com/data",
		},
	}

	// Marshal to Struct
	taskConfig, err := validation.MarshalTaskConfig(httpConfig)
	require.NoError(t, err)

	// Create workflow spec
	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "http-workflow",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "fetch-data",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
				TaskConfig: taskConfig,
				Export: &workflowv1.Export{
					As: "${.}",
				},
			},
		},
	}

	converter := NewConverter()
	yaml, err := converter.ProtoToYAML(spec)
	require.NoError(t, err)

	// Verify HTTP call structure
	assert.Contains(t, yaml, "fetch-data:")
	assert.Contains(t, yaml, "call: http")
	assert.Contains(t, yaml, "with:")
	assert.Contains(t, yaml, "method: GET")
	assert.Contains(t, yaml, "export:")

	t.Logf("Generated YAML:\n%s", yaml)
}

func TestProtoToYAML_WithFlowControl(t *testing.T) {
	// Create typed protos for two tasks
	validateConfig := &tasksv1.SetTaskConfig{
		Variables: map[string]string{
			"valid": "true",
		},
	}
	processConfig := &tasksv1.SetTaskConfig{
		Variables: map[string]string{
			"status": "processed",
		},
	}

	// Marshal to Structs
	validateTaskConfig, err := validation.MarshalTaskConfig(validateConfig)
	require.NoError(t, err)
	processTaskConfig, err := validation.MarshalTaskConfig(processConfig)
	require.NoError(t, err)

	// Create workflow spec
	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "flow-workflow",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "validate",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
				TaskConfig: validateTaskConfig,
				Flow: &workflowv1.FlowControl{
					Then: "process",
				},
			},
			{
				Name:       "process",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
				TaskConfig: processTaskConfig,
				Flow: &workflowv1.FlowControl{
					Then: "end",
				},
			},
		},
	}

	converter := NewConverter()
	yaml, err := converter.ProtoToYAML(spec)
	require.NoError(t, err)

	// Verify flow control
	assert.Contains(t, yaml, "then: process")
	assert.Contains(t, yaml, "then: end")

	t.Logf("Generated YAML:\n%s", yaml)
}

func TestProtoToYAML_MissingDocument(t *testing.T) {
	// Create typed proto
	setConfig := &tasksv1.SetTaskConfig{
		Variables: map[string]string{},
	}
	taskConfig, err := validation.MarshalTaskConfig(setConfig)
	require.NoError(t, err)

	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "task1",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
				TaskConfig: taskConfig,
			},
		},
	}

	converter := NewConverter()
	_, err = converter.ProtoToYAML(spec)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "document")
}

func TestProtoToYAML_NoTasks(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "empty-workflow",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{},
	}

	converter := NewConverter()
	_, err := converter.ProtoToYAML(spec)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "task")
}

// Phase 3: Additional tests for type-safe converters

func TestProtoToYAML_GrpcCallTask(t *testing.T) {
	// Create typed proto
	grpcConfig := &tasksv1.GrpcCallTaskConfig{
		Service: "UserService",
		Method:  "GetUser",
	}

	taskConfig, err := validation.MarshalTaskConfig(grpcConfig)
	require.NoError(t, err)

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "grpc-workflow",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "get-user",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_GRPC_CALL,
				TaskConfig: taskConfig,
			},
		},
	}

	converter := NewConverter()
	yaml, err := converter.ProtoToYAML(spec)
	require.NoError(t, err)

	assert.Contains(t, yaml, "get-user:")
	assert.Contains(t, yaml, "call: grpc")
	assert.Contains(t, yaml, "service: UserService")
	assert.Contains(t, yaml, "method: GetUser")
}

func TestProtoToYAML_WaitTask(t *testing.T) {
	// Create typed proto
	waitConfig := &tasksv1.WaitTaskConfig{
		Seconds: 5,
	}

	taskConfig, err := validation.MarshalTaskConfig(waitConfig)
	require.NoError(t, err)

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "wait-workflow",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "pause",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_WAIT,
				TaskConfig: taskConfig,
			},
		},
	}

	converter := NewConverter()
	yaml, err := converter.ProtoToYAML(spec)
	require.NoError(t, err)

	assert.Contains(t, yaml, "pause:")
	assert.Contains(t, yaml, "wait: 5")
}

func TestProtoToYAML_SwitchTask(t *testing.T) {
	// Create typed proto
	switchConfig := &tasksv1.SwitchTaskConfig{
		Cases: []*tasksv1.SwitchCase{
			{
				Name: "success",
				When: "${result.status == 200}",
				Then: "handleSuccess",
			},
			{
				Name: "notFound",
				When: "${result.status == 404}",
				Then: "handleNotFound",
			},
		},
	}

	taskConfig, err := validation.MarshalTaskConfig(switchConfig)
	require.NoError(t, err)

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "switch-workflow",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "route",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH,
				TaskConfig: taskConfig,
			},
		},
	}

	converter := NewConverter()
	yaml, err := converter.ProtoToYAML(spec)
	require.NoError(t, err)

	assert.Contains(t, yaml, "route:")
	assert.Contains(t, yaml, "switch:")
	assert.Contains(t, yaml, "cases:")
}

func TestProtoToYAML_ComplexWorkflow(t *testing.T) {
	// Create multiple typed protos
	setConfig := &tasksv1.SetTaskConfig{
		Variables: map[string]string{
			"userId": "123",
		},
	}
	httpConfig := &tasksv1.HttpCallTaskConfig{
		Method: "GET",
		Endpoint: &tasksv1.HttpEndpoint{
			Uri: "https://api.example.com/users/${userId}",
		},
		TimeoutSeconds: 30,
	}
	waitConfig := &tasksv1.WaitTaskConfig{
		Seconds: 2,
	}

	// Marshal all configs
	setTaskConfig, err := validation.MarshalTaskConfig(setConfig)
	require.NoError(t, err)
	httpTaskConfig, err := validation.MarshalTaskConfig(httpConfig)
	require.NoError(t, err)
	waitTaskConfig, err := validation.MarshalTaskConfig(waitConfig)
	require.NoError(t, err)

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:         "1.0.0",
			Namespace:   "test",
			Name:        "complex-workflow",
			Version:     "1.0",
			Description: "A workflow with multiple task types",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "set-user-id",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
				TaskConfig: setTaskConfig,
				Flow: &workflowv1.FlowControl{
					Then: "fetch-user",
				},
			},
			{
				Name:       "fetch-user",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
				TaskConfig: httpTaskConfig,
				Export: &workflowv1.Export{
					As: "${.user}",
				},
				Flow: &workflowv1.FlowControl{
					Then: "pause",
				},
			},
			{
				Name:       "pause",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_WAIT,
				TaskConfig: waitTaskConfig,
			},
		},
	}

	converter := NewConverter()
	yaml, err := converter.ProtoToYAML(spec)
	require.NoError(t, err)

	// Verify all tasks are present
	assert.Contains(t, yaml, "set-user-id:")
	assert.Contains(t, yaml, "fetch-user:")
	assert.Contains(t, yaml, "pause:")

	// Verify document fields
	assert.Contains(t, yaml, "description: A workflow with multiple task types")

	// Verify flow control
	assert.Contains(t, yaml, "then: fetch-user")
	assert.Contains(t, yaml, "then: pause")

	// Verify export
	assert.Contains(t, yaml, "export:")

	t.Logf("Generated YAML:\n%s", yaml)
}
