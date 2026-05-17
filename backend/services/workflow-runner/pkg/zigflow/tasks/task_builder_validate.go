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

// ValidateTaskBuilder handles validate tasks that perform JSON Schema and
// business-rule validation on workflow data.
type ValidateTaskBuilder struct {
	builder[*model.CallFunction]
	config *workflowtasks.ValidateTaskConfig
}

func NewValidateTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallFunction,
	taskName string,
	doc *model.Workflow,
) (*ValidateTaskBuilder, error) {
	if task.Call != customCallFunctionValidate {
		return nil, fmt.Errorf("unsupported call type '%s' for validate builder", task.Call)
	}
	return &ValidateTaskBuilder{
		builder: builder[*model.CallFunction]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

func (t *ValidateTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	log.Debug().Str("task", t.GetTaskName()).Msg("Building validate task")

	if err := t.parseConfig(); err != nil {
		return nil, err
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		// Resolve the input data to validate
		dataToValidate, err := t.resolveInput(state)
		if err != nil {
			logger.Error("Error resolving validate input", "error", err)
			return nil, fmt.Errorf("error resolving validate input: %w", err)
		}

		logger.Info("Executing validate activity", "task", t.GetTaskName())

		var res any
		if err := workflow.ExecuteActivity(ctx, (*ValidateActivities).ValidateActivity,
			t.config, dataToValidate, state.Env).Get(ctx, &res); err != nil {
			return nil, fmt.Errorf("validate activity failed: %w", err)
		}

		state.AddData(map[string]any{t.GetTaskName(): res})
		return res, nil
	}, nil
}

func (t *ValidateTaskBuilder) parseConfig() error {
	withBytes, err := json.Marshal(t.task.With)
	if err != nil {
		return fmt.Errorf("failed to marshal task.With: %w", err)
	}

	t.config = &workflowtasks.ValidateTaskConfig{}
	if err := protojson.Unmarshal(withBytes, t.config); err != nil {
		return fmt.Errorf("failed to unmarshal validate config: %w", err)
	}

	if t.config.Input == "" {
		return fmt.Errorf("input field is required in validate config")
	}

	hasSchema := t.config.Schema != nil && len(t.config.Schema.AsMap()) > 0
	hasRules := len(t.config.Rules) > 0
	if !hasSchema && !hasRules {
		return fmt.Errorf("at least one of schema or rules must be set in validate config")
	}

	log.Debug().Str("task", t.GetTaskName()).Msg("Validate config parsed")
	return nil
}

func (t *ValidateTaskBuilder) resolveInput(state *utils.State) (any, error) {
	evaluated, err := utils.EvaluateString(t.config.Input, nil, state)
	if err != nil {
		return nil, fmt.Errorf("error evaluating validate input: %w", err)
	}
	return evaluated, nil
}

var _ TaskBuilder = &ValidateTaskBuilder{}
