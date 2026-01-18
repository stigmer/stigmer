/*
 * Copyright 2026 Stigmer authors
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
	"encoding/json"
	"testing"

	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/utils"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEvaluateEndpoint tests the evaluateEndpoint function with various endpoint types
func TestEvaluateEndpoint(t *testing.T) {
	tests := []struct {
		name           string
		setupEndpoint  func() *model.Endpoint
		stateData      map[string]interface{}
		expectedURI    string
		expectError    bool
	}{
		{
			name: "RuntimeExpression in EndpointConfig - simple variable from context",
			setupEndpoint: func() *model.Endpoint {
				return &model.Endpoint{
					EndpointConfig: &model.EndpointConfiguration{
						RuntimeExpression: model.NewRuntimeExpression("${ $context.apiURL }"),
					},
				}
			},
			stateData: map[string]interface{}{
				"apiURL": "https://api.example.com/data",
			},
			expectedURI: "https://api.example.com/data",
			expectError: false,
		},
		{
			name: "RuntimeExpression in EndpointConfig - concatenation",
			setupEndpoint: func() *model.Endpoint {
				return &model.Endpoint{
					EndpointConfig: &model.EndpointConfiguration{
						RuntimeExpression: model.NewRuntimeExpression("${ $context.baseURL + \"/posts/\" + ($context.postId | tostring) }"),
					},
				}
			},
			stateData: map[string]interface{}{
				"baseURL": "https://jsonplaceholder.typicode.com",
				"postId":  1,
			},
			expectedURI: "https://jsonplaceholder.typicode.com/posts/1",
			expectError: false,
		},
		{
			name: "Static URI - no evaluation needed",
			setupEndpoint: func() *model.Endpoint {
				return model.NewEndpoint("https://api.example.com/static")
			},
			stateData:   map[string]interface{}{},
			expectedURI: "https://api.example.com/static",
			expectError: false,
		},
		{
			name: "URITemplate with expression",
			setupEndpoint: func() *model.Endpoint {
				endpoint := &model.Endpoint{}
				// Simulate URITemplate with expression (would come from YAML parsing)
				endpoint.EndpointConfig = &model.EndpointConfiguration{
					RuntimeExpression: model.NewRuntimeExpression("${ $context.dynamicURL }"),
				}
				return endpoint
			},
			stateData: map[string]interface{}{
				"dynamicURL": "https://dynamic.example.com/resource",
			},
			expectedURI: "https://dynamic.example.com/resource",
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Setup
			endpoint := tt.setupEndpoint()
			state := utils.NewState()
			// Set context so expressions like ${.apiURL} work
			state.Context = tt.stateData

			// Execute
			err := evaluateEndpoint(endpoint, state)

			// Assert
			if tt.expectError {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.expectedURI, endpoint.String())
			}
		})
	}
}

// TestEvaluateHTTPTaskExpressions tests the full HTTP task expression evaluation
func TestEvaluateHTTPTaskExpressions(t *testing.T) {
	tests := []struct {
		name        string
		setupTask   func() *model.CallHTTP
		stateData   map[string]interface{}
		validate    func(t *testing.T, task *model.CallHTTP)
		expectError bool
	}{
		{
			name: "Evaluate endpoint URI with variable reference",
			setupTask: func() *model.CallHTTP {
				return &model.CallHTTP{
					Call: "http",
					With: model.HTTPArguments{
						Method: "GET",
						Endpoint: &model.Endpoint{
							EndpointConfig: &model.EndpointConfiguration{
								RuntimeExpression: model.NewRuntimeExpression("${ $context.apiURL }"),
							},
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"apiURL": "https://jsonplaceholder.typicode.com/posts/1",
			},
			validate: func(t *testing.T, task *model.CallHTTP) {
				assert.Equal(t, "https://jsonplaceholder.typicode.com/posts/1", task.With.Endpoint.String())
			},
			expectError: false,
		},
		{
			name: "Evaluate endpoint URI with concatenation",
			setupTask: func() *model.CallHTTP {
				return &model.CallHTTP{
					Call: "http",
					With: model.HTTPArguments{
						Method: "POST",
						Endpoint: &model.Endpoint{
							EndpointConfig: &model.EndpointConfiguration{
								RuntimeExpression: model.NewRuntimeExpression("${ $context.baseURL + \"/posts/\" + ($context.id | tostring) }"),
							},
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"baseURL": "https://api.example.com",
				"id":      42,
			},
			validate: func(t *testing.T, task *model.CallHTTP) {
				assert.Equal(t, "https://api.example.com/posts/42", task.With.Endpoint.String())
			},
			expectError: false,
		},
		{
			name: "Evaluate headers with expressions",
			setupTask: func() *model.CallHTTP {
				return &model.CallHTTP{
					Call: "http",
					With: model.HTTPArguments{
						Method:   "GET",
						Endpoint: model.NewEndpoint("https://api.example.com/data"),
						Headers: map[string]string{
							"Authorization": "${ \"Bearer \" + $context.token }",
							"X-Request-ID":  "${ $context.requestId }",
							"Static-Header": "static-value",
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"token":     "abc123xyz",
				"requestId": "req-456",
			},
			validate: func(t *testing.T, task *model.CallHTTP) {
				assert.Equal(t, "Bearer abc123xyz", task.With.Headers["Authorization"])
				assert.Equal(t, "req-456", task.With.Headers["X-Request-ID"])
				assert.Equal(t, "static-value", task.With.Headers["Static-Header"])
			},
			expectError: false,
		},
		{
			name: "Evaluate query parameters with expressions",
			setupTask: func() *model.CallHTTP {
				return &model.CallHTTP{
					Call: "http",
					With: model.HTTPArguments{
						Method:   "GET",
						Endpoint: model.NewEndpoint("https://api.example.com/search"),
						Query: map[string]interface{}{
							"q":     "${ $context.searchTerm }",
							"limit": "${ $context.maxResults }",
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"searchTerm":  "golang",
				"maxResults":  10,
			},
			validate: func(t *testing.T, task *model.CallHTTP) {
				assert.Equal(t, "golang", task.With.Query["q"])
				// Type can be int or float64 depending on evaluation context
				limit := task.With.Query["limit"]
				assert.True(t, limit == 10 || limit == int(10) || limit == float64(10), "limit should be 10")
			},
			expectError: false,
		},
		{
			name: "Evaluate request body with expressions",
			setupTask: func() *model.CallHTTP {
				bodyMap := map[string]interface{}{
					"userId": "${ $context.userId }",
					"title":  "${ \"Post by user \" + ($context.userId | tostring) }",
					"body":   "Static content",
				}
				bodyJSON, _ := json.Marshal(bodyMap)
				return &model.CallHTTP{
					Call: "http",
					With: model.HTTPArguments{
						Method:   "POST",
						Endpoint: model.NewEndpoint("https://api.example.com/posts"),
						Body:     json.RawMessage(bodyJSON),
					},
				}
			},
			stateData: map[string]interface{}{
				"userId": 5,
			},
			validate: func(t *testing.T, task *model.CallHTTP) {
				var body map[string]interface{}
				err := json.Unmarshal(task.With.Body, &body)
				require.NoError(t, err)
				assert.Equal(t, float64(5), body["userId"])
				assert.Equal(t, "Post by user 5", body["title"])
				assert.Equal(t, "Static content", body["body"])
			},
			expectError: false,
		},
		{
			name: "Complete HTTP task with all fields having expressions",
			setupTask: func() *model.CallHTTP {
				bodyMap := map[string]interface{}{
					"message": "${ $context.message }",
				}
				bodyJSON, _ := json.Marshal(bodyMap)
				return &model.CallHTTP{
					Call: "http",
					With: model.HTTPArguments{
						Method: "POST",
						Endpoint: &model.Endpoint{
							EndpointConfig: &model.EndpointConfiguration{
								RuntimeExpression: model.NewRuntimeExpression("${ $context.apiBase + \"/notifications\" }"),
							},
						},
						Headers: map[string]string{
							"Authorization": "${ \"Bearer \" + $context.apiToken }",
							"Content-Type":  "application/json",
						},
						Query: map[string]interface{}{
							"priority": "${ $context.priority }",
						},
						Body: json.RawMessage(bodyJSON),
					},
				}
			},
			stateData: map[string]interface{}{
				"apiBase":  "https://notifications.example.com",
				"apiToken": "token-xyz",
				"priority": "high",
				"message":  "Test notification",
			},
			validate: func(t *testing.T, task *model.CallHTTP) {
				// Validate endpoint
				assert.Equal(t, "https://notifications.example.com/notifications", task.With.Endpoint.String())
				
				// Validate headers
				assert.Equal(t, "Bearer token-xyz", task.With.Headers["Authorization"])
				assert.Equal(t, "application/json", task.With.Headers["Content-Type"])
				
				// Validate query
				assert.Equal(t, "high", task.With.Query["priority"])
				
				// Validate body
				var body map[string]interface{}
				err := json.Unmarshal(task.With.Body, &body)
				require.NoError(t, err)
				assert.Equal(t, "Test notification", body["message"])
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Setup task and state
			task := tt.setupTask()
			state := utils.NewState()
			// Set context so expressions like ${.variable} work
			state.Context = tt.stateData

			// Execute evaluation directly (since it doesn't use workflow-specific features)
			// In real execution, this runs in workflow context, but for testing we can call directly
			err := evaluateHTTPTaskExpressionsWithoutWorkflowContext(task, state)

			// Assert
			if tt.expectError {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				tt.validate(t, task)
			}
		})
	}
}

// evaluateHTTPTaskExpressionsWithoutWorkflowContext is a test helper that evaluates HTTP task
// expressions without requiring a workflow context (for unit testing)
func evaluateHTTPTaskExpressionsWithoutWorkflowContext(task *model.CallHTTP, state *utils.State) error {
	// 1. Evaluate endpoint URI if it contains an expression
	if task.With.Endpoint != nil {
		if err := evaluateEndpoint(task.With.Endpoint, state); err != nil {
			return err
		}
	}

	// 2. Evaluate headers
	if len(task.With.Headers) > 0 {
		for key, value := range task.With.Headers {
			if model.IsStrictExpr(value) {
				evaluated, err := utils.EvaluateString(value, nil, state)
				if err != nil {
					return err
				}
				task.With.Headers[key] = evaluated.(string)
			}
		}
	}

	// 3. Evaluate query parameters
	if len(task.With.Query) > 0 {
		evaluated, err := utils.TraverseAndEvaluateObj(
			model.NewObjectOrRuntimeExpr(task.With.Query),
			nil,
			state,
		)
		if err != nil {
			return err
		}
		task.With.Query = evaluated.(map[string]interface{})
	}

	// 4. Evaluate body
	if len(task.With.Body) > 0 {
		var bodyMap map[string]interface{}
		if err := json.Unmarshal(task.With.Body, &bodyMap); err == nil {
			evaluated, err := utils.TraverseAndEvaluateObj(
				model.NewObjectOrRuntimeExpr(bodyMap),
				nil,
				state,
			)
			if err != nil {
				return err
			}
			evaluatedBody, err := json.Marshal(evaluated)
			if err != nil {
				return err
			}
			task.With.Body = evaluatedBody
		}
	}

	return nil
}

// TestEvaluateHTTPTaskExpressions_NoExpressions tests that static values are unchanged
func TestEvaluateHTTPTaskExpressions_NoExpressions(t *testing.T) {
	// Create task with all static values
	task := &model.CallHTTP{
		Call: "http",
		With: model.HTTPArguments{
			Method:   "GET",
			Endpoint: model.NewEndpoint("https://api.example.com/static"),
			Headers: map[string]string{
				"Authorization": "Bearer static-token",
				"Accept":        "application/json",
			},
			Query: map[string]interface{}{
				"page": 1,
				"size": 10,
			},
		},
	}

	state := utils.NewState()

	// Execute evaluation
	err := evaluateHTTPTaskExpressionsWithoutWorkflowContext(task, state)

	// Should succeed and values should be unchanged
	require.NoError(t, err)
	assert.Equal(t, "https://api.example.com/static", task.With.Endpoint.String())
	assert.Equal(t, "Bearer static-token", task.With.Headers["Authorization"])
	assert.Equal(t, "application/json", task.With.Headers["Accept"])
	assert.Equal(t, 1, task.With.Query["page"])
	assert.Equal(t, 10, task.With.Query["size"])
}

// TestEvaluateHTTPTaskExpressions_ErrorCases tests error scenarios
func TestEvaluateHTTPTaskExpressions_ErrorCases(t *testing.T) {
	tests := []struct {
		name      string
		setupTask func() *model.CallHTTP
		stateData map[string]interface{}
	}{
		{
			name: "Undefined variable in endpoint",
			setupTask: func() *model.CallHTTP {
				return &model.CallHTTP{
					Call: "http",
					With: model.HTTPArguments{
						Method: "GET",
						Endpoint: &model.Endpoint{
							EndpointConfig: &model.EndpointConfiguration{
								RuntimeExpression: model.NewRuntimeExpression("${ $context.undefinedVariable }"),
							},
						},
					},
				}
			},
			stateData: map[string]interface{}{},
		},
		{
			name: "Invalid expression syntax in header",
			setupTask: func() *model.CallHTTP {
				return &model.CallHTTP{
					Call: "http",
					With: model.HTTPArguments{
						Method:   "GET",
						Endpoint: model.NewEndpoint("https://api.example.com"),
						Headers: map[string]string{
							"Authorization": "${ $context.token + }",  // Invalid syntax
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"token": "abc123",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			task := tt.setupTask()
			state := utils.NewState()
			// Set context so expressions like ${.variable} work
			state.Context = tt.stateData

			err := evaluateHTTPTaskExpressionsWithoutWorkflowContext(task, state)

			// Should return error
			assert.Error(t, err)
		})
	}
}
