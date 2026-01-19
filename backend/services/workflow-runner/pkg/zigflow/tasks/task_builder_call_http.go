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
	"encoding/json"
	"fmt"

	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// @link: https://github.com/serverlessworkflow/specification/blob/main/dsl-reference.md#http-response
type HTTPResponse struct {
	Request    HTTPRequest       `json:"request"`
	StatusCode int               `json:"statusCode"`
	Headers    map[string]string `json:"headers,omitempty"`
	Content    any               `json:"content,omitempty"`
}

// @link: https://github.com/serverlessworkflow/specification/blob/main/dsl-reference.md#http-request
type HTTPRequest struct {
	Method  string            `json:"method"`
	URI     string            `json:"uri"`
	Headers map[string]string `json:"headers,omitempty"`
}

func NewCallHTTPTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallHTTP,
	taskName string,
	doc *model.Workflow,
) (*CallHTTPTaskBuilder, error) {
	return &CallHTTPTaskBuilder{
		builder: builder[*model.CallHTTP]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

type CallHTTPTaskBuilder struct {
	builder[*model.CallHTTP]
}

func (t *CallHTTPTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		return t.executeActivity(ctx, (*CallHTTPActivities).CallHTTPActivity, input, state)
	}, nil
}

// evaluateHTTPTaskExpressions evaluates all expressions in an HTTP task using direct field access.
// This replaces the JSON marshal/unmarshal approach to avoid SDK unmarshaling issues.
func evaluateHTTPTaskExpressions(ctx workflow.Context, task *model.CallHTTP, state *utils.State) error {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Evaluating HTTP task expressions with direct field access")

	// 1. Evaluate endpoint URI if it contains an expression
	if task.With.Endpoint != nil {
		if err := evaluateEndpoint(task.With.Endpoint, state); err != nil {
			return err
		}
	}

	// 2. Evaluate headers (map[string]string)
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

	// 3. Evaluate query parameters (map[string]interface{})
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

	// 4. Evaluate body (json.RawMessage) if it contains expressions
	if len(task.With.Body) > 0 {
		// Parse body to map for evaluation
		var bodyMap map[string]interface{}
		if err := json.Unmarshal(task.With.Body, &bodyMap); err == nil {
			// Body is JSON object - evaluate expressions
			evaluated, err := utils.TraverseAndEvaluateObj(
				model.NewObjectOrRuntimeExpr(bodyMap),
				nil,
				state,
			)
			if err != nil {
				return err
			}
			// Marshal back to RawMessage
			evaluatedBody, err := json.Marshal(evaluated)
			if err != nil {
				return err
			}
			task.With.Body = evaluatedBody
		}
		// If unmarshal fails, body is likely a string or other type - leave as-is
	}

	logger.Debug("HTTP task expressions evaluated successfully")
	return nil
}

// evaluateEndpoint evaluates expressions in an Endpoint field.
// Handles RuntimeExpression in EndpointConfig by replacing it with a static URI.
func evaluateEndpoint(endpoint *model.Endpoint, state *utils.State) error {
	// Check if endpoint has a RuntimeExpression in EndpointConfig
	if endpoint.EndpointConfig != nil && endpoint.EndpointConfig.RuntimeExpression != nil {
		expr := endpoint.EndpointConfig.RuntimeExpression.String()
		
		// Evaluate the expression
		result, err := utils.EvaluateString(expr, nil, state)
		if err != nil {
			return err
		}
		
		// Check if result is nil
		if result == nil {
			return fmt.Errorf("expression evaluation returned nil for: %s", expr)
		}
		
		// Convert result to string
		resultStr, ok := result.(string)
		if !ok {
			return fmt.Errorf("expression evaluation returned non-string type %T for: %s", result, expr)
		}
		
		// Replace endpoint with evaluated static URI
		// This avoids unmarshaling issues by using SDK's constructor
		*endpoint = *model.NewEndpoint(resultStr)
		return nil
	}

	// Check if endpoint has a URITemplate with expression
	if endpoint.URITemplate != nil {
		uri := endpoint.URITemplate.String()
		if model.IsStrictExpr(uri) {
			// Evaluate the expression
			result, err := utils.EvaluateString(uri, nil, state)
			if err != nil {
				return err
			}
			
			// Check if result is nil
			if result == nil {
				return fmt.Errorf("expression evaluation returned nil for: %s", uri)
			}
			
			// Convert result to string
			resultStr, ok := result.(string)
			if !ok {
				return fmt.Errorf("expression evaluation returned non-string type %T for: %s", result, uri)
			}
			
			// Replace with evaluated static URI
			*endpoint = *model.NewEndpoint(resultStr)
			return nil
		}
	}

	// No expressions to evaluate
	return nil
}
