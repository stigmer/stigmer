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

// CallLlmTaskBuilder handles llm_call tasks that make direct LLM API calls
// without the overhead of a full agent invocation.
type CallLlmTaskBuilder struct {
	builder[*model.CallFunction]
	config *workflowtasks.LlmCallTaskConfig
}

func NewCallLlmTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallFunction,
	taskName string,
	doc *model.Workflow,
) (*CallLlmTaskBuilder, error) {
	if task.Call != customCallFunctionLlm {
		return nil, fmt.Errorf("unsupported call type '%s' for llm builder", task.Call)
	}
	return &CallLlmTaskBuilder{
		builder: builder[*model.CallFunction]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

func (t *CallLlmTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	log.Debug().Str("task", t.GetTaskName()).Msg("Building llm_call task")

	if err := t.parseConfig(); err != nil {
		return nil, err
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		if err := t.evaluateExpressions(ctx, state); err != nil {
			logger.Error("Error evaluating llm_call expressions", "error", err)
			return nil, fmt.Errorf("error evaluating llm_call expressions: %w", err)
		}

		logger.Info("Executing llm_call activity",
			"model", t.config.Model,
			"task", t.GetTaskName())

		var res any
		if err := workflow.ExecuteActivity(ctx, (*CallLlmActivities).CallLlmActivity,
			t.config, input, state.Env).Get(ctx, &res); err != nil {
			return nil, fmt.Errorf("llm_call activity failed: %w", err)
		}

		state.AddData(map[string]any{t.GetTaskName(): res})
		return res, nil
	}, nil
}

func (t *CallLlmTaskBuilder) parseConfig() error {
	withBytes, err := json.Marshal(t.task.With)
	if err != nil {
		return fmt.Errorf("failed to marshal task.With: %w", err)
	}

	t.config = &workflowtasks.LlmCallTaskConfig{}
	if err := protojson.Unmarshal(withBytes, t.config); err != nil {
		return fmt.Errorf("failed to unmarshal llm_call config: %w", err)
	}

	if t.config.Model == "" {
		return fmt.Errorf("model field is required in llm_call config")
	}
	if t.config.Prompt == "" {
		return fmt.Errorf("prompt field is required in llm_call config")
	}

	log.Debug().
		Str("task", t.GetTaskName()).
		Str("model", t.config.Model).
		Msg("LLM call config parsed")

	return nil
}

func (t *CallLlmTaskBuilder) evaluateExpressions(ctx workflow.Context, state *utils.State) error {
	if model.IsStrictExpr(t.config.Prompt) {
		evaluated, err := utils.EvaluateString(t.config.Prompt, nil, state)
		if err != nil {
			return fmt.Errorf("error evaluating prompt expression: %w", err)
		}
		if s, ok := evaluated.(string); ok {
			t.config.Prompt = s
		}
	}

	if t.config.SystemPrompt != "" && model.IsStrictExpr(t.config.SystemPrompt) {
		evaluated, err := utils.EvaluateString(t.config.SystemPrompt, nil, state)
		if err != nil {
			return fmt.Errorf("error evaluating system_prompt expression: %w", err)
		}
		if s, ok := evaluated.(string); ok {
			t.config.SystemPrompt = s
		}
	}

	return nil
}

var _ TaskBuilder = &CallLlmTaskBuilder{}
