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

	apiresourcev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

// TestMarshalTaskConfig_Success tests successful marshaling of typed protos
func TestMarshalTaskConfig_Success(t *testing.T) {
	testCases := []struct {
		name  string
		proto proto.Message
	}{
		{
			name: "SET task",
			proto: &tasksv1.SetTaskConfig{
				Variables: map[string]string{
					"key1": "value1",
					"key2": "value2",
				},
			},
		},
		{
			name: "HTTP_CALL task",
			proto: &tasksv1.HttpCallTaskConfig{
				Method: "GET",
				Endpoint: &tasksv1.HttpEndpoint{
					Uri: "https://api.example.com",
				},
				Headers: map[string]string{
					"Authorization": "Bearer token",
				},
				TimeoutSeconds: 30,
			},
		},
		{
			name: "GRPC_CALL task",
			proto: &tasksv1.GrpcCallTaskConfig{
				Service: "MyService",
				Method:  "MyMethod",
			},
		},
		{
			name: "WAIT task",
			proto: &tasksv1.WaitTaskConfig{
				Seconds: 5,
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Marshal typed proto to Struct
			result, err := MarshalTaskConfig(tc.proto)
			require.NoError(t, err)
			require.NotNil(t, result)

			// Verify Struct is not empty
			assert.NotEmpty(t, result.Fields)
		})
	}
}

// TestMarshalTaskConfig_RoundTrip tests that typed → Struct → typed produces identical proto
func TestMarshalTaskConfig_RoundTrip(t *testing.T) {
	testCases := []struct {
		name       string
		kind       apiresourcev1.WorkflowTaskKind
		original   proto.Message
	}{
		{
			name: "SET task round-trip",
			kind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
			original: &tasksv1.SetTaskConfig{
				Variables: map[string]string{
					"foo": "bar",
					"baz": "qux",
				},
			},
		},
		{
			name: "HTTP_CALL task round-trip",
			kind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
			original: &tasksv1.HttpCallTaskConfig{
				Method: "POST",
				Endpoint: &tasksv1.HttpEndpoint{
					Uri: "https://api.example.com/users",
				},
				Headers: map[string]string{
					"Content-Type": "application/json",
				},
				TimeoutSeconds: 120,
			},
		},
		{
			name: "GRPC_CALL task round-trip",
			kind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_GRPC_CALL,
			original: &tasksv1.GrpcCallTaskConfig{
				Service: "UserService",
				Method:  "GetUser",
			},
		},
		{
			name: "SWITCH task round-trip",
			kind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH,
			original: &tasksv1.SwitchTaskConfig{
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
			},
		},
		// Note: FOR, FORK, TRY, LISTEN have complex nested structures with WorkflowTask arrays
		// They are tested separately in integration tests
		{
			name: "WAIT task round-trip",
			kind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_WAIT,
			original: &tasksv1.WaitTaskConfig{
				Seconds: 10,
			},
		},
		{
			name: "RAISE task round-trip",
			kind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_RAISE,
			original: &tasksv1.RaiseTaskConfig{
				Error:   "ValidationError",
				Message: "Invalid input data",
			},
		},
		{
			name: "RUN task round-trip",
			kind: apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_RUN,
			original: &tasksv1.RunTaskConfig{
				Workflow: "child-workflow",
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Step 1: Marshal typed proto to Struct
			structConfig, err := MarshalTaskConfig(tc.original)
			require.NoError(t, err)
			require.NotNil(t, structConfig)

			// Step 2: Unmarshal Struct back to typed proto
			recovered, err := UnmarshalTaskConfig(tc.kind, structConfig)
			require.NoError(t, err)
			require.NotNil(t, recovered)

			// Step 3: Verify recovered proto equals original
			assert.True(t, proto.Equal(tc.original, recovered),
				"Round-trip should produce identical proto.\nOriginal: %v\nRecovered: %v",
				tc.original, recovered)
		})
	}
}

// TestMarshalTaskConfig_NilProto tests error handling for nil proto
func TestMarshalTaskConfig_NilProto(t *testing.T) {
	result, err := MarshalTaskConfig(nil)
	assert.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "cannot be nil")
}

// TestMarshalTaskConfig_FieldNames verifies JSON field names are used (not Go field names)
func TestMarshalTaskConfig_FieldNames(t *testing.T) {
	// Create typed proto with specific fields
	httpConfig := &tasksv1.HttpCallTaskConfig{
		Method: "GET",
		Endpoint: &tasksv1.HttpEndpoint{
			Uri: "https://api.example.com",
		},
		TimeoutSeconds: 30,
	}

	// Marshal to Struct
	result, err := MarshalTaskConfig(httpConfig)
	require.NoError(t, err)
	require.NotNil(t, result)

	// Verify JSON field names are used (protojson uses camelCase for JSON)
	assert.Contains(t, result.Fields, "method", "Should have 'method' field")
	assert.Contains(t, result.Fields, "endpoint", "Should have 'endpoint' field")
	assert.Contains(t, result.Fields, "timeoutSeconds", "Should have 'timeoutSeconds' field (JSON name)")

	// Verify Go struct field names are NOT used (PascalCase)
	assert.NotContains(t, result.Fields, "Method", "Should NOT have 'Method' field (Go name)")
	assert.NotContains(t, result.Fields, "Endpoint", "Should NOT have 'Endpoint' field (Go name)")
	assert.NotContains(t, result.Fields, "TimeoutSeconds", "Should NOT have 'TimeoutSeconds' field (Go name)")
}
