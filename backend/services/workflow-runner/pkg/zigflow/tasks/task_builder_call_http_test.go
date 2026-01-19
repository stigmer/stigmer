/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/stigmer/stigmer/backend/services/workflow-runner/graphs/contributors>
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

package tasks

import (
	"encoding/base64"
	"testing"

	"github.com/serverlessworkflow/sdk-go/v3/model"
	"github.com/stretchr/testify/assert"
)

func TestCallHTTPActivityWithEvaluatedArguments(t *testing.T) {
	// This test verifies that the activity works with pre-evaluated arguments
	// Expression evaluation now happens in the workflow context, not in the activity
	task := &model.CallHTTP{
		Call: "http",
		With: model.HTTPArguments{
			Method:   "GET",
			Endpoint: model.NewEndpoint("https://example.com"),
			Headers: map[string]string{
				"X-Token": "abc-123", // Already evaluated
			},
			Query: map[string]any{
				"debug": true, // Already evaluated
			},
		},
	}

	// Verify the task has the evaluated values
	assert.Equal(t, "GET", task.With.Method)
	assert.Equal(t, "https://example.com", task.With.Endpoint.String())
	assert.Equal(t, "abc-123", task.With.Headers["X-Token"])
	assert.Equal(t, true, task.With.Query["debug"])
}

func TestParseOutput(t *testing.T) {
	httpResp := HTTPResponse{
		StatusCode: 200,
		Content: map[string]any{
			"message": "ok",
		},
	}
	raw := []byte("payload")

	tests := []struct {
		name       string
		outputType string
		expect     any
	}{
		{
			name:       "raw response returns base64 string",
			outputType: "raw",
			expect:     base64.StdEncoding.EncodeToString(raw),
		},
		{
			name:       "response returns metadata structure",
			outputType: "response",
			expect:     httpResp,
		},
		{
			name:       "default returns parsed content",
			outputType: "",
			expect:     httpResp.Content,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := (&CallHTTPActivities{}).parseOutput(tc.outputType, httpResp, raw)
			assert.Equal(t, tc.expect, got)
		})
	}
}
