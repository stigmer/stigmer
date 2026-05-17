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

package tasks

import (
	"encoding/json"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/encoding/protojson"
)

// TransformTaskBuilder handles transform tasks that perform deterministic data
// transformation using JQ, Go templates, or JSONata expressions.
type TransformTaskBuilder struct {
	builder[*model.CallFunction]
	config *workflowtasks.TransformTaskConfig
}

func NewTransformTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallFunction,
	taskName string,
	doc *model.Workflow,
) (*TransformTaskBuilder, error) {
	if task.Call != customCallFunctionTransform {
		return nil, fmt.Errorf("unsupported call type '%s' for transform builder", task.Call)
	}
	return &TransformTaskBuilder{
		builder: builder[*model.CallFunction]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

func (t *TransformTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	log.Debug().Str("task", t.GetTaskName()).Msg("Building transform task")

	if err := t.parseConfig(); err != nil {
		return nil, err
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		if err := t.evaluateExpressions(ctx, state); err != nil {
			logger.Error("Error evaluating transform expressions", "error", err)
			return nil, fmt.Errorf("error evaluating transform expressions: %w", err)
		}

		transformInput, err := t.resolveInput(state)
		if err != nil {
			logger.Error("Error resolving transform input", "error", err)
			return nil, fmt.Errorf("error resolving transform input: %w", err)
		}

		logger.Info("Executing transform activity",
			"engine", t.config.Engine.String(),
			"task", t.GetTaskName())

		var res any
		if err := workflow.ExecuteActivity(ctx, (*TransformActivities).TransformActivity,
			t.config, transformInput, state.Env).Get(ctx, &res); err != nil {
			return nil, fmt.Errorf("transform activity failed: %w", err)
		}

		state.AddData(map[string]any{t.GetTaskName(): res})
		return res, nil
	}, nil
}

func (t *TransformTaskBuilder) parseConfig() error {
	withBytes, err := json.Marshal(t.task.With)
	if err != nil {
		return fmt.Errorf("failed to marshal task.With: %w", err)
	}

	t.config = &workflowtasks.TransformTaskConfig{}
	if err := protojson.Unmarshal(withBytes, t.config); err != nil {
		return fmt.Errorf("failed to unmarshal transform config: %w", err)
	}

	if t.config.Expression == "" {
		return fmt.Errorf("expression field is required in transform config")
	}

	log.Debug().
		Str("task", t.GetTaskName()).
		Str("engine", t.config.Engine.String()).
		Msg("Transform config parsed")

	return nil
}

func (t *TransformTaskBuilder) evaluateExpressions(ctx workflow.Context, state *utils.State) error {
	if t.config.Input != "" && model.IsStrictExpr(t.config.Input) {
		evaluated, err := utils.EvaluateString(t.config.Input, nil, state)
		if err != nil {
			return fmt.Errorf("error evaluating input expression: %w", err)
		}
		// Input evaluated — store as resolved data for the activity
		// The activity receives the resolved input, not the expression
		_ = evaluated
	}
	return nil
}

// resolveInput resolves the input data for the transformation.
// If config.Input is set, evaluates it as an expression against state.
// Otherwise, uses the entire workflow context.
func (t *TransformTaskBuilder) resolveInput(state *utils.State) (any, error) {
	if t.config.Input != "" {
		evaluated, err := utils.EvaluateString(t.config.Input, nil, state)
		if err != nil {
			return nil, fmt.Errorf("error evaluating transform input: %w", err)
		}
		return evaluated, nil
	}
	return state.Data, nil
}

var _ TaskBuilder = &TransformTaskBuilder{}
