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
	"errors"
	"testing"

	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/utils"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEvaluateGRPCTaskExpressions tests the full gRPC task expression evaluation
func TestEvaluateGRPCTaskExpressions(t *testing.T) {
	tests := []struct {
		name        string
		setupTask   func() *model.CallGRPC
		stateData   map[string]interface{}
		validate    func(t *testing.T, task *model.CallGRPC)
		expectError bool
	}{
		{
			name: "Evaluate service name with variable reference",
			setupTask: func() *model.CallGRPC {
				return &model.CallGRPC{
					Call: "grpc",
					With: model.GRPCArguments{
						Service: model.GRPCService{
							Name: "${ $context.serviceName }",
							Host: "localhost",
							Port: 50051,
						},
						Method: "GetUser",
						Proto: &model.ExternalResource{
							Endpoint: model.NewEndpoint("file:///proto/user.proto"),
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"serviceName": "com.example.UserService",
			},
			validate: func(t *testing.T, task *model.CallGRPC) {
				assert.Equal(t, "com.example.UserService", task.With.Service.Name)
				assert.Equal(t, "localhost", task.With.Service.Host)
				assert.Equal(t, 50051, task.With.Service.Port)
			},
			expectError: false,
		},
		{
			name: "Evaluate service host with variable reference",
			setupTask: func() *model.CallGRPC {
				return &model.CallGRPC{
					Call: "grpc",
					With: model.GRPCArguments{
						Service: model.GRPCService{
							Name: "com.example.PaymentService",
							Host: "${ $context.grpcHost }",
							Port: 50051,
						},
						Method: "ProcessPayment",
						Proto: &model.ExternalResource{
							Endpoint: model.NewEndpoint("file:///proto/payment.proto"),
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"grpcHost": "grpc-payments.example.com",
			},
			validate: func(t *testing.T, task *model.CallGRPC) {
				assert.Equal(t, "com.example.PaymentService", task.With.Service.Name)
				assert.Equal(t, "grpc-payments.example.com", task.With.Service.Host)
				assert.Equal(t, 50051, task.With.Service.Port)
			},
			expectError: false,
		},
		{
			name: "Evaluate method name with variable reference",
			setupTask: func() *model.CallGRPC {
				return &model.CallGRPC{
					Call: "grpc",
					With: model.GRPCArguments{
						Service: model.GRPCService{
							Name: "com.example.DataService",
							Host: "localhost",
							Port: 50051,
						},
						Method: "${ $context.methodName }",
						Proto: &model.ExternalResource{
							Endpoint: model.NewEndpoint("file:///proto/data.proto"),
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"methodName": "FetchData",
			},
			validate: func(t *testing.T, task *model.CallGRPC) {
				assert.Equal(t, "com.example.DataService", task.With.Service.Name)
				assert.Equal(t, "FetchData", task.With.Method)
			},
			expectError: false,
		},
		{
			name: "Evaluate proto endpoint with variable reference",
			setupTask: func() *model.CallGRPC {
				return &model.CallGRPC{
					Call: "grpc",
					With: model.GRPCArguments{
						Service: model.GRPCService{
							Name: "com.example.FileService",
							Host: "localhost",
							Port: 50051,
						},
						Method: "UploadFile",
						Proto: &model.ExternalResource{
							Endpoint: &model.Endpoint{
								EndpointConfig: &model.EndpointConfiguration{
									RuntimeExpression: model.NewRuntimeExpression("${ $context.protoPath }"),
								},
							},
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"protoPath": "file:///var/protos/file_service.proto",
			},
			validate: func(t *testing.T, task *model.CallGRPC) {
				assert.Equal(t, "com.example.FileService", task.With.Service.Name)
				assert.Equal(t, "file:///var/protos/file_service.proto", task.With.Proto.Endpoint.String())
			},
			expectError: false,
		},
		{
			name: "Evaluate arguments with expressions",
			setupTask: func() *model.CallGRPC {
				return &model.CallGRPC{
					Call: "grpc",
					With: model.GRPCArguments{
						Service: model.GRPCService{
							Name: "com.example.UserService",
							Host: "localhost",
							Port: 50051,
						},
						Method: "GetUser",
						Proto: &model.ExternalResource{
							Endpoint: model.NewEndpoint("file:///proto/user.proto"),
						},
						Arguments: map[string]interface{}{
							"userId":      "${ $context.userId }",
							"username":    "${ $context.username }",
							"staticField": "static-value",
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"userId":   12345,
				"username": "john_doe",
			},
			validate: func(t *testing.T, task *model.CallGRPC) {
				// Type can be int or float64 depending on evaluation context
				userId := task.With.Arguments["userId"]
				assert.True(t, userId == 12345 || userId == int(12345) || userId == float64(12345), "userId should be 12345")
				assert.Equal(t, "john_doe", task.With.Arguments["username"])
				assert.Equal(t, "static-value", task.With.Arguments["staticField"])
			},
			expectError: false,
		},
		{
			name: "Evaluate nested arguments with expressions",
			setupTask: func() *model.CallGRPC {
				return &model.CallGRPC{
					Call: "grpc",
					With: model.GRPCArguments{
						Service: model.GRPCService{
							Name: "com.example.CustomerService",
							Host: "localhost",
							Port: 50051,
						},
						Method: "CreateCustomer",
						Proto: &model.ExternalResource{
							Endpoint: model.NewEndpoint("file:///proto/customer.proto"),
						},
						Arguments: map[string]interface{}{
							"customer": map[string]interface{}{
								"id":    "${ $context.customerId }",
								"name":  "${ $context.customerName }",
								"email": "static@example.com",
							},
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"customerId":   456,
				"customerName": "Jane Smith",
			},
			validate: func(t *testing.T, task *model.CallGRPC) {
				customer := task.With.Arguments["customer"].(map[string]interface{})
				// Type can be int or float64 depending on evaluation context
				customerId := customer["id"]
				assert.True(t, customerId == 456 || customerId == int(456) || customerId == float64(456), "customerId should be 456")
				assert.Equal(t, "Jane Smith", customer["name"])
				assert.Equal(t, "static@example.com", customer["email"])
			},
			expectError: false,
		},
		{
			name: "Complete gRPC task with all fields having expressions",
			setupTask: func() *model.CallGRPC {
				return &model.CallGRPC{
					Call: "grpc",
					With: model.GRPCArguments{
						Service: model.GRPCService{
							Name: "${ $context.serviceName }",
							Host: "${ $context.serviceHost }",
							Port: 50051,
						},
						Method: "${ $context.methodName }",
						Proto: &model.ExternalResource{
							Endpoint: &model.Endpoint{
								EndpointConfig: &model.EndpointConfiguration{
									RuntimeExpression: model.NewRuntimeExpression("${ $context.protoPath }"),
								},
							},
						},
						Arguments: map[string]interface{}{
							"data": "${ $context.data }",
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"serviceName": "com.example.CompleteService",
				"serviceHost": "complete.example.com",
				"methodName":  "ProcessData",
				"protoPath":   "file:///proto/complete.proto",
				"data":        "test-data",
			},
			validate: func(t *testing.T, task *model.CallGRPC) {
				assert.Equal(t, "com.example.CompleteService", task.With.Service.Name)
				assert.Equal(t, "complete.example.com", task.With.Service.Host)
				assert.Equal(t, "ProcessData", task.With.Method)
				assert.Equal(t, "file:///proto/complete.proto", task.With.Proto.Endpoint.String())
				assert.Equal(t, "test-data", task.With.Arguments["data"])
			},
			expectError: false,
		},
		{
			name: "String concatenation in service name",
			setupTask: func() *model.CallGRPC {
				return &model.CallGRPC{
					Call: "grpc",
					With: model.GRPCArguments{
						Service: model.GRPCService{
							Name: "${ $context.namespace + \".\" + $context.service }",
							Host: "localhost",
							Port: 50051,
						},
						Method: "GetAnalytics",
						Proto: &model.ExternalResource{
							Endpoint: model.NewEndpoint("file:///proto/analytics.proto"),
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"namespace": "com.example",
				"service":   "analytics",
			},
			validate: func(t *testing.T, task *model.CallGRPC) {
				assert.Equal(t, "com.example.analytics", task.With.Service.Name)
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Setup task and state
			task := tt.setupTask()
			state := utils.NewState()
			state.Context = tt.stateData

			// Execute evaluation
			err := evaluateGRPCTaskExpressionsWithoutWorkflowContext(task, state)

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

// TestEvaluateGRPCTaskExpressions_NoExpressions tests that static values are unchanged
func TestEvaluateGRPCTaskExpressions_NoExpressions(t *testing.T) {
	// Create task with all static values
	task := &model.CallGRPC{
		Call: "grpc",
		With: model.GRPCArguments{
			Service: model.GRPCService{
				Name: "com.example.StaticService",
				Host: "static.example.com",
				Port: 50051,
			},
			Method: "StaticMethod",
			Proto: &model.ExternalResource{
				Endpoint: model.NewEndpoint("file:///proto/static.proto"),
			},
			Arguments: map[string]interface{}{
				"field1": "static-value",
				"field2": 42,
			},
		},
	}

	state := utils.NewState()

	// Execute evaluation
	err := evaluateGRPCTaskExpressionsWithoutWorkflowContext(task, state)

	// Should succeed and values should be unchanged
	require.NoError(t, err)
	assert.Equal(t, "com.example.StaticService", task.With.Service.Name)
	assert.Equal(t, "static.example.com", task.With.Service.Host)
	assert.Equal(t, 50051, task.With.Service.Port)
	assert.Equal(t, "StaticMethod", task.With.Method)
	assert.Equal(t, "file:///proto/static.proto", task.With.Proto.Endpoint.String())
	assert.Equal(t, "static-value", task.With.Arguments["field1"])
	assert.Equal(t, 42, task.With.Arguments["field2"])
}

// TestEvaluateGRPCTaskExpressions_ErrorCases tests error scenarios
func TestEvaluateGRPCTaskExpressions_ErrorCases(t *testing.T) {
	tests := []struct {
		name      string
		setupTask func() *model.CallGRPC
		stateData map[string]interface{}
	}{
		{
			name: "Undefined variable in service name",
			setupTask: func() *model.CallGRPC {
				return &model.CallGRPC{
					Call: "grpc",
					With: model.GRPCArguments{
						Service: model.GRPCService{
							Name: "${ $context.undefinedVariable }",
							Host: "localhost",
							Port: 50051,
						},
						Method: "GetUser",
						Proto: &model.ExternalResource{
							Endpoint: model.NewEndpoint("file:///proto/user.proto"),
						},
					},
				}
			},
			stateData: map[string]interface{}{},
		},
		{
			name: "Invalid expression syntax in method",
			setupTask: func() *model.CallGRPC {
				return &model.CallGRPC{
					Call: "grpc",
					With: model.GRPCArguments{
						Service: model.GRPCService{
							Name: "com.example.Service",
							Host: "localhost",
							Port: 50051,
						},
						Method: "${ $context.method + }",
						Proto: &model.ExternalResource{
							Endpoint: model.NewEndpoint("file:///proto/service.proto"),
						},
					},
				}
			},
			stateData: map[string]interface{}{
				"method": "GetData",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			task := tt.setupTask()
			state := utils.NewState()
			state.Context = tt.stateData

			err := evaluateGRPCTaskExpressionsWithoutWorkflowContext(task, state)

			// Should return error
			assert.Error(t, err)
		})
	}
}

// TestEvaluateGRPCTaskExpressions_MixedStaticAndDynamic tests combination of static and dynamic fields
func TestEvaluateGRPCTaskExpressions_MixedStaticAndDynamic(t *testing.T) {
	task := &model.CallGRPC{
		Call: "grpc",
		With: model.GRPCArguments{
			Service: model.GRPCService{
				Name: "${ $context.serviceName }",
				Host: "static-host.example.com",
				Port: 50051,
			},
			Method: "StaticMethod",
			Proto: &model.ExternalResource{
				Endpoint: &model.Endpoint{
					EndpointConfig: &model.EndpointConfiguration{
						RuntimeExpression: model.NewRuntimeExpression("${ $context.protoPath }"),
					},
				},
			},
			Arguments: map[string]interface{}{
				"dynamicField": "${ $context.value }",
				"staticField":  "static-value",
			},
		},
	}

	state := utils.NewState()
	state.Context = map[string]interface{}{
		"serviceName": "com.example.MixedService",
		"protoPath":   "file:///proto/mixed.proto",
		"value":       "dynamic-value",
	}

	err := evaluateGRPCTaskExpressionsWithoutWorkflowContext(task, state)

	require.NoError(t, err)
	// Dynamic fields should be evaluated
	assert.Equal(t, "com.example.MixedService", task.With.Service.Name)
	assert.Equal(t, "file:///proto/mixed.proto", task.With.Proto.Endpoint.String())
	assert.Equal(t, "dynamic-value", task.With.Arguments["dynamicField"])
	// Static fields should remain unchanged
	assert.Equal(t, "static-host.example.com", task.With.Service.Host)
	assert.Equal(t, "StaticMethod", task.With.Method)
	assert.Equal(t, "static-value", task.With.Arguments["staticField"])
}

// evaluateGRPCTaskExpressionsWithoutWorkflowContext is a test helper
// This mirrors the actual implementation but works without workflow.Context
func evaluateGRPCTaskExpressionsWithoutWorkflowContext(task *model.CallGRPC, state *utils.State) error {
	// 1. Evaluate service name
	if model.IsStrictExpr(task.With.Service.Name) {
		evaluated, err := utils.EvaluateString(task.With.Service.Name, nil, state)
		if err != nil {
			return err
		}
		if evaluated == nil {
			return errors.New("service name evaluated to nil")
		}
		task.With.Service.Name = evaluated.(string)
	}

	// 2. Evaluate service host
	if model.IsStrictExpr(task.With.Service.Host) {
		evaluated, err := utils.EvaluateString(task.With.Service.Host, nil, state)
		if err != nil {
			return err
		}
		if evaluated == nil {
			return errors.New("service host evaluated to nil")
		}
		task.With.Service.Host = evaluated.(string)
	}

	// 3. Evaluate method
	if model.IsStrictExpr(task.With.Method) {
		evaluated, err := utils.EvaluateString(task.With.Method, nil, state)
		if err != nil {
			return err
		}
		if evaluated == nil {
			return errors.New("method evaluated to nil")
		}
		task.With.Method = evaluated.(string)
	}

	// 4. Evaluate proto endpoint
	if task.With.Proto.Endpoint != nil {
		if err := evaluateEndpoint(task.With.Proto.Endpoint, state); err != nil {
			return err
		}
	}

	// 5. Evaluate arguments
	if len(task.With.Arguments) > 0 {
		evaluated, err := utils.TraverseAndEvaluateObj(
			model.NewObjectOrRuntimeExpr(task.With.Arguments),
			nil,
			state,
		)
		if err != nil {
			return err
		}
		task.With.Arguments = evaluated.(map[string]interface{})
	}

	return nil
}
