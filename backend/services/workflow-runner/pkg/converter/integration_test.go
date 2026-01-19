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

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	apiresourcev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/validation"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// Integration tests for Phase 3 typed proto conversion.
//
// These tests verify the complete pipeline:
// 1. Typed Proto → Struct (marshal)
// 2. Struct → Typed Proto (unmarshal)
// 3. Typed Proto → YAML (convert)
//
// They ensure validation and conversion work together correctly.

// TestE2E_TypedProtoToYAML_AllTaskTypes verifies conversion for all task types
func TestE2E_TypedProtoToYAML_AllTaskTypes(t *testing.T) {
	testCases := []struct {
		name         string
		taskKind     apiresourcev1.WorkflowTaskKind
		typedProto   proto.Message
		expectYAML   []string // Strings that should appear in YAML
	}{
		{
			name:     "SET task",
			taskKind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
			typedProto: &tasksv1.SetTaskConfig{
				Variables: map[string]string{
					"key": "value",
					"foo": "bar",
				},
			},
			expectYAML: []string{"set:", "key: value", "foo: bar"},
		},
		{
			name:     "HTTP_CALL task",
			taskKind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
			typedProto: &tasksv1.HttpCallTaskConfig{
				Method: "GET",
				Endpoint: &tasksv1.HttpEndpoint{
					Uri: "https://api.example.com",
				},
				TimeoutSeconds: 30,
			},
			expectYAML: []string{"call: http", "with:", "method: GET", "endpoint:", "uri: https://api.example.com", "timeout_seconds: 30"},
		},
		{
			name:     "GRPC_CALL task",
			taskKind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_GRPC_CALL,
			typedProto: &tasksv1.GrpcCallTaskConfig{
				Service: "UserService",
				Method:  "GetUser",
			},
			expectYAML: []string{"call: grpc", "service: UserService", "method: GetUser"},
		},
		{
			name:     "SWITCH task",
			taskKind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH,
			typedProto: &tasksv1.SwitchTaskConfig{
				Cases: []*tasksv1.SwitchCase{
					{
						Name: "case1",
						When: "${x == 1}",
						Then: "task1",
					},
				},
			},
			expectYAML: []string{"switch:", "cases:"},
		},
		// Note: FOR, FORK, TRY, LISTEN have complex nested WorkflowTask arrays
		// They require recursive conversion which is beyond the scope of this refactoring
		{
			name:     "WAIT task",
			taskKind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_WAIT,
			typedProto: &tasksv1.WaitTaskConfig{
				Seconds: 5,
			},
			expectYAML: []string{"wait: 5"},
		},
		{
			name:     "RAISE task",
			taskKind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_RAISE,
			typedProto: &tasksv1.RaiseTaskConfig{
				Error:   "ValidationError",
				Message: "Invalid data",
			},
			expectYAML: []string{"raise:", "error: ValidationError"},
		},
		{
			name:     "RUN task",
			taskKind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_RUN,
			typedProto: &tasksv1.RunTaskConfig{
				Workflow: "child-workflow",
			},
			expectYAML: []string{"run:", "workflow: child-workflow"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Step 1: Marshal typed proto to Struct
			taskConfig, err := validation.MarshalTaskConfig(tc.typedProto)
			require.NoError(t, err, "Failed to marshal typed proto")

			// Step 2: Create workflow spec
			spec := &workflowv1.WorkflowSpec{
				Document: &workflowv1.WorkflowDocument{
					Dsl:       "1.0.0",
					Namespace: "test",
					Name:      "test-workflow",
					Version:   "1.0",
				},
				Tasks: []*workflowv1.WorkflowTask{
					{
						Name:       "testTask",
						Kind:       tc.taskKind,
						TaskConfig: taskConfig,
					},
				},
			}

			// Step 3: Convert to YAML
			conv := NewConverter()
			yaml, err := conv.ProtoToYAML(spec)
			require.NoError(t, err, "Failed to convert to YAML")

			// Step 4: Verify YAML contains expected structures
			for _, expected := range tc.expectYAML {
				assert.Contains(t, yaml, expected,
					"YAML should contain '%s'", expected)
			}

			t.Logf("Generated YAML for %s:\n%s", tc.name, yaml)
		})
	}
}

// TestE2E_RoundTrip verifies that typed → Struct → typed → YAML works correctly
func TestE2E_RoundTrip(t *testing.T) {
	// Create typed proto
	original := &tasksv1.HttpCallTaskConfig{
		Method: "POST",
		Endpoint: &tasksv1.HttpEndpoint{
			Uri: "https://api.example.com/users",
		},
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Authorization": "Bearer token",
		},
		TimeoutSeconds: 120,
	}

	// Step 1: Marshal to Struct
	structConfig, err := validation.MarshalTaskConfig(original)
	require.NoError(t, err)

	// Step 2: Unmarshal back to typed proto
	recovered, err := validation.UnmarshalTaskConfig(
		apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
		structConfig,
	)
	require.NoError(t, err)

	// Step 3: Verify recovered proto equals original
	assert.True(t, proto.Equal(original, recovered),
		"Round-trip should produce identical proto")

	// Step 4: Convert to YAML using converter
	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "test",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "httpTask",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
				TaskConfig: structConfig,
			},
		},
	}

	conv := NewConverter()
	yaml, err := conv.ProtoToYAML(spec)
	require.NoError(t, err)

	// Verify YAML contains all expected fields
	assert.Contains(t, yaml, "call: http")
	assert.Contains(t, yaml, "uri: https://api.example.com/users")
	assert.Contains(t, yaml, "Content-Type: application/json")
	assert.Contains(t, yaml, "timeout_seconds: 120")
}

// TestE2E_ValidationIntegration verifies validation + conversion works together
func TestE2E_ValidationIntegration_InvalidConfig(t *testing.T) {
	// Create INVALID typed proto (will fail validation)
	invalidConfig := &tasksv1.HttpCallTaskConfig{
		Method: "INVALID_METHOD", // Invalid!
		Endpoint: &tasksv1.HttpEndpoint{
			Uri: "", // Empty URI - invalid!
		},
		TimeoutSeconds: 500, // Out of range!
	}

	// Marshal to Struct (this should work - no validation yet)
	taskConfig, err := validation.MarshalTaskConfig(invalidConfig)
	require.NoError(t, err)

	// Create workflow spec
	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "test",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "invalidTask",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
				TaskConfig: taskConfig,
			},
		},
	}

	// Converter should fail when trying to unmarshal (uses validation.UnmarshalTaskConfig)
	conv := NewConverter()
	_, err = conv.ProtoToYAML(spec)
	if assert.Error(t, err, "Converter should reject invalid config") {
		assert.Contains(t, err.Error(), "failed to unmarshal")
	}
}

// TestE2E_ValidationIntegration_ValidConfig verifies valid configs pass through
func TestE2E_ValidationIntegration_ValidConfig(t *testing.T) {
	// Create VALID typed proto
	validConfig := &tasksv1.HttpCallTaskConfig{
		Method: "GET",
		Endpoint: &tasksv1.HttpEndpoint{
			Uri: "https://api.example.com",
		},
		TimeoutSeconds: 30,
	}

	// Marshal to Struct
	taskConfig, err := validation.MarshalTaskConfig(validConfig)
	require.NoError(t, err)

	// Validate (should pass)
	_, err = validation.UnmarshalTaskConfig(
		apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
		taskConfig,
	)
	require.NoError(t, err, "Valid config should pass validation")

	// Create workflow spec
	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "test",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "validTask",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
				TaskConfig: taskConfig,
			},
		},
	}

	// Converter should succeed
	conv := NewConverter()
	yaml, err := conv.ProtoToYAML(spec)
	require.NoError(t, err, "Valid config should convert successfully")
	assert.Contains(t, yaml, "call: http")
}

// TestE2E_EmptyOptionalFields verifies optional fields are handled correctly
func TestE2E_EmptyOptionalFields(t *testing.T) {
	// Create HTTP config with only required fields
	httpConfig := &tasksv1.HttpCallTaskConfig{
		Method: "GET",
		Endpoint: &tasksv1.HttpEndpoint{
			Uri: "https://api.example.com",
		},
		// No headers, no timeout, no body
	}

	taskConfig, err := validation.MarshalTaskConfig(httpConfig)
	require.NoError(t, err)

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "test",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "minimalTask",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
				TaskConfig: taskConfig,
			},
		},
	}

	conv := NewConverter()
	yaml, err := conv.ProtoToYAML(spec)
	require.NoError(t, err)

	// Should contain required fields
	assert.Contains(t, yaml, "call: http")
	assert.Contains(t, yaml, "uri: https://api.example.com")

	// Should NOT contain empty optional fields
	// (YAML marshaler omits zero values)
	assert.NotContains(t, yaml, "timeout_seconds: 0")
	assert.NotContains(t, yaml, "body:")
}

// TestE2E_NilTaskConfig verifies nil task config is rejected
func TestE2E_NilTaskConfig(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "test",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "nilConfigTask",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
				TaskConfig: nil, // Nil config
			},
		},
	}

	conv := NewConverter()
	_, err := conv.ProtoToYAML(spec)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to unmarshal")
}

// TestE2E_ComplexNestedStructures verifies nested structures work correctly
func TestE2E_ComplexNestedStructures(t *testing.T) {
	// Create SWITCH task with multiple cases (nested structure)
	switchConfig := &tasksv1.SwitchTaskConfig{
		Cases: []*tasksv1.SwitchCase{
			{
				Name: "success",
				When: "${status == 200}",
				Then: "success",
			},
			{
				Name: "notFound",
				When: "${status == 404}",
				Then: "notFound",
			},
			{
				Name: "serverError",
				When: "${status >= 500}",
				Then: "serverError",
			},
		},
	}

	taskConfig, err := validation.MarshalTaskConfig(switchConfig)
	require.NoError(t, err)

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "test",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "routeByStatus",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH,
				TaskConfig: taskConfig,
			},
		},
	}

	conv := NewConverter()
	yaml, err := conv.ProtoToYAML(spec)
	require.NoError(t, err)

	// Verify all cases are present
	assert.Contains(t, yaml, "switch:")
	assert.Contains(t, yaml, "cases:")
	assert.Contains(t, yaml, "status == 200")
	assert.Contains(t, yaml, "status == 404")
	assert.Contains(t, yaml, "status >= 500")
}

// TestE2E_BodyAsStruct verifies Struct fields (like body, request) work correctly
func TestE2E_BodyAsStruct(t *testing.T) {
	// Create body as Struct
	body, err := structpb.NewStruct(map[string]interface{}{
		"username": "testuser",
		"email":    "test@example.com",
		"age":      25,
	})
	require.NoError(t, err)

	httpConfig := &tasksv1.HttpCallTaskConfig{
		Method: "POST",
		Endpoint: &tasksv1.HttpEndpoint{
			Uri: "https://api.example.com/users",
		},
		Body: body,
	}

	taskConfig, err := validation.MarshalTaskConfig(httpConfig)
	require.NoError(t, err)

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "test",
			Version:   "1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "createUser",
				Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
				TaskConfig: taskConfig,
			},
		},
	}

	conv := NewConverter()
	yaml, err := conv.ProtoToYAML(spec)
	require.NoError(t, err)

	// Verify body fields are present
	assert.Contains(t, yaml, "body:")
	assert.Contains(t, yaml, "username: testuser")
	assert.Contains(t, yaml, "email: test@example.com")
	assert.Contains(t, yaml, "age: 25")
}
