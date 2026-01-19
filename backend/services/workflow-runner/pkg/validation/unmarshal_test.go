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
	"google.golang.org/protobuf/types/known/structpb"
)

func TestUnmarshalSetTaskConfig(t *testing.T) {
	t.Run("valid config", func(t *testing.T) {
		config, err := structpb.NewStruct(map[string]interface{}{
			"variables": map[string]interface{}{
				"status": "initialized",
				"count":  "${ .items | length }",
			},
		})
		require.NoError(t, err)

		msg, err := UnmarshalTaskConfig(
			apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
			config,
		)

		require.NoError(t, err)
		require.NotNil(t, msg)

		setConfig, ok := msg.(*tasksv1.SetTaskConfig)
		require.True(t, ok, "expected SetTaskConfig type")
		assert.Equal(t, "initialized", setConfig.Variables["status"])
		assert.Equal(t, "${ .items | length }", setConfig.Variables["count"])
	})

	t.Run("nil config", func(t *testing.T) {
		_, err := UnmarshalTaskConfig(
			apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
			nil,
		)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "task_config cannot be nil")
	})
}

func TestUnmarshalHttpCallTaskConfig(t *testing.T) {
	t.Run("valid config", func(t *testing.T) {
		config, err := structpb.NewStruct(map[string]interface{}{
			"method": "GET",
			"endpoint": map[string]interface{}{
				"uri": "https://api.example.com/data",
			},
			"headers": map[string]interface{}{
				"Authorization": "Bearer ${TOKEN}",
			},
		})
		require.NoError(t, err)

		msg, err := UnmarshalTaskConfig(
			apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
			config,
		)

		require.NoError(t, err)
		require.NotNil(t, msg)

		httpConfig, ok := msg.(*tasksv1.HttpCallTaskConfig)
		require.True(t, ok, "expected HttpCallTaskConfig type")
		assert.Equal(t, "GET", httpConfig.Method)
		assert.Equal(t, "https://api.example.com/data", httpConfig.Endpoint.Uri)
		assert.Equal(t, "Bearer ${TOKEN}", httpConfig.Headers["Authorization"])
	})

	t.Run("nested endpoint structure", func(t *testing.T) {
		config, err := structpb.NewStruct(map[string]interface{}{
			"method": "POST",
			"endpoint": map[string]interface{}{
				"uri": "https://api.example.com/submit",
			},
			"body": map[string]interface{}{
				"field1": "value1",
				"field2": 42,
			},
		})
		require.NoError(t, err)

		msg, err := UnmarshalTaskConfig(
			apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
			config,
		)

		require.NoError(t, err)
		httpConfig := msg.(*tasksv1.HttpCallTaskConfig)
		assert.NotNil(t, httpConfig.Endpoint)
		assert.NotNil(t, httpConfig.Body)
	})
}

func TestUnmarshalSwitchTaskConfig(t *testing.T) {
	t.Run("valid config with cases", func(t *testing.T) {
		config, err := structpb.NewStruct(map[string]interface{}{
			"cases": []interface{}{
				map[string]interface{}{
					"name": "highValue",
					"when": "${ .value > 100 }",
					"then": "processHighValue",
				},
				map[string]interface{}{
					"name": "default",
					"then": "processDefault",
				},
			},
		})
		require.NoError(t, err)

		msg, err := UnmarshalTaskConfig(
			apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH,
			config,
		)

		require.NoError(t, err)
		require.NotNil(t, msg)

		switchConfig, ok := msg.(*tasksv1.SwitchTaskConfig)
		require.True(t, ok, "expected SwitchTaskConfig type")
		require.Len(t, switchConfig.Cases, 2)
		
		assert.Equal(t, "highValue", switchConfig.Cases[0].Name)
		assert.Equal(t, "${ .value > 100 }", switchConfig.Cases[0].When)
		assert.Equal(t, "processHighValue", switchConfig.Cases[0].Then)
		
		assert.Equal(t, "default", switchConfig.Cases[1].Name)
		assert.Equal(t, "", switchConfig.Cases[1].When) // No when = default case
		assert.Equal(t, "processDefault", switchConfig.Cases[1].Then)
	})
}

func TestUnmarshalWaitTaskConfig(t *testing.T) {
	t.Run("valid config", func(t *testing.T) {
		config, err := structpb.NewStruct(map[string]interface{}{
			"seconds": 5,
		})
		require.NoError(t, err)

		msg, err := UnmarshalTaskConfig(
			apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_WAIT,
			config,
		)

		require.NoError(t, err)
		require.NotNil(t, msg)

		waitConfig, ok := msg.(*tasksv1.WaitTaskConfig)
		require.True(t, ok, "expected WaitTaskConfig type")
		assert.Equal(t, int32(5), waitConfig.Seconds)
	})
}

func TestUnmarshalRaiseTaskConfig(t *testing.T) {
	t.Run("valid config", func(t *testing.T) {
		config, err := structpb.NewStruct(map[string]interface{}{
			"error":   "ValidationError",
			"message": "Invalid input provided",
		})
		require.NoError(t, err)

		msg, err := UnmarshalTaskConfig(
			apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_RAISE,
			config,
		)

		require.NoError(t, err)
		require.NotNil(t, msg)

		raiseConfig, ok := msg.(*tasksv1.RaiseTaskConfig)
		require.True(t, ok, "expected RaiseTaskConfig type")
		assert.Equal(t, "ValidationError", raiseConfig.Error)
		assert.Equal(t, "Invalid input provided", raiseConfig.Message)
	})
}

func TestUnmarshalUnsupportedTaskKind(t *testing.T) {
	config, err := structpb.NewStruct(map[string]interface{}{
		"test": "value",
	})
	require.NoError(t, err)

	_, err = UnmarshalTaskConfig(
		apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_UNSPECIFIED,
		config,
	)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported task kind")
}
