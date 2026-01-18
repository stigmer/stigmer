/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/graphs/contributors>
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
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/utils"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func NewCallGRPCTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallGRPC,
	taskName string,
	doc *model.Workflow,
) (*CallGRPCTaskBuilder, error) {
	return &CallGRPCTaskBuilder{
		builder: builder[*model.CallGRPC]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

type CallGRPCTaskBuilder struct {
	builder[*model.CallGRPC]
}

func (t *CallGRPCTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	if t.task.With.Service.Host == "" {
		t.task.With.Service.Host = "localhost"
	}
	if t.task.With.Service.Port == 0 {
		t.task.With.Service.Port = 50051
	}

	return func(ctx workflow.Context, input any, state *utils.State) (output any, err error) {
		return t.executeActivity(ctx, (*CallGRPCActivities).CallGRPCActivity, input, state)
	}, nil
}

// evaluateGRPCTaskExpressions evaluates all expressions in a gRPC task using direct field access.
// This replaces the JSON marshal/unmarshal approach to avoid SDK unmarshaling issues.
func evaluateGRPCTaskExpressions(ctx workflow.Context, task *model.CallGRPC, state *utils.State) error {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Evaluating gRPC task expressions with direct field access")

	// 1. Evaluate service name if it contains an expression
	if model.IsStrictExpr(task.With.Service.Name) {
		evaluated, err := utils.EvaluateString(task.With.Service.Name, nil, state)
		if err != nil {
			return err
		}
		task.With.Service.Name = evaluated.(string)
	}

	// 2. Evaluate service host if it contains an expression
	if model.IsStrictExpr(task.With.Service.Host) {
		evaluated, err := utils.EvaluateString(task.With.Service.Host, nil, state)
		if err != nil {
			return err
		}
		task.With.Service.Host = evaluated.(string)
	}

	// 3. Evaluate method if it contains an expression
	if model.IsStrictExpr(task.With.Method) {
		evaluated, err := utils.EvaluateString(task.With.Method, nil, state)
		if err != nil {
			return err
		}
		task.With.Method = evaluated.(string)
	}

	// 4. Evaluate proto endpoint if it contains expressions
	if task.With.Proto.Endpoint != nil {
		if err := evaluateEndpoint(task.With.Proto.Endpoint, state); err != nil {
			return err
		}
	}

	// 5. Evaluate arguments (map[string]interface{})
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

	logger.Debug("gRPC task expressions evaluated successfully")
	return nil
}
