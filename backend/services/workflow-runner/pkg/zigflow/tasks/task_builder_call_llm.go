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

	"github.com/rs/zerolog/log"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/encoding/protojson"
)

func NewCallLlmTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallFunction,
	taskName string,
	doc *model.Workflow,
) (*CallLlmTaskBuilder, error) {
	if task.Call != customCallFunctionLlm {
		return nil, fmt.Errorf("unsupported call task '%s' for llm builder", task.Call)
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

type CallLlmTaskBuilder struct {
	builder[*model.CallFunction]

	llmConfig *workflowtasks.LlmCallTaskConfig
}

func (t *CallLlmTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	log.Debug().Str("task", t.GetTaskName()).Msg("Building call llm task")

	if err := t.parseConfig(); err != nil {
		log.Error().Err(err).Msg("Error parsing llm call configuration")
		return nil, err
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		if err := t.evaluateExpressions(ctx, state); err != nil {
			logger.Error("Error evaluating llm task expressions", "error", err)
			return nil, fmt.Errorf("error evaluating llm task expressions: %w", err)
		}

		workflowExecutionId := workflow.GetInfo(ctx).WorkflowExecution.ID

		logger.Info("Executing llm call activity",
			"model", t.llmConfig.Model,
			"task", t.GetTaskName(),
			"workflow_execution_id", workflowExecutionId)

		var res any
		future := workflow.ExecuteActivity(ctx, (*CallLlmActivities).CallLlmActivity,
			t.llmConfig, workflowExecutionId)
		if err := future.Get(ctx, &res); err != nil {
			logger.Error("LLM call activity failed", "error", err)
			return nil, fmt.Errorf("llm call activity failed: %w", err)
		}

		state.AddData(map[string]any{
			t.GetTaskName(): res,
		})

		return res, nil
	}, nil
}

func (t *CallLlmTaskBuilder) parseConfig() error {
	withBytes, err := json.Marshal(t.task.With)
	if err != nil {
		return fmt.Errorf("failed to marshal task.With: %w", err)
	}

	t.llmConfig = &workflowtasks.LlmCallTaskConfig{}
	if err := protojson.Unmarshal(withBytes, t.llmConfig); err != nil {
		return fmt.Errorf("failed to unmarshal llm call config: %w", err)
	}

	if t.llmConfig.Model == "" {
		return fmt.Errorf("model field is required in llm call config")
	}
	if t.llmConfig.Prompt == "" {
		return fmt.Errorf("prompt field is required in llm call config")
	}

	log.Debug().
		Str("task", t.GetTaskName()).
		Str("model", t.llmConfig.Model).
		Msg("LLM call config parsed successfully")

	return nil
}

func (t *CallLlmTaskBuilder) evaluateExpressions(ctx workflow.Context, state *utils.State) error {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Evaluating llm task expressions in workflow context")

	if model.IsStrictExpr(t.llmConfig.Prompt) {
		evaluated, err := utils.EvaluateString(t.llmConfig.Prompt, nil, state)
		if err != nil {
			return fmt.Errorf("error evaluating prompt expression: %w", err)
		}
		if evaluatedStr, ok := evaluated.(string); ok {
			t.llmConfig.Prompt = evaluatedStr
		} else {
			return fmt.Errorf("prompt expression must evaluate to string, got %T", evaluated)
		}
	}

	if t.llmConfig.SystemPrompt != "" && model.IsStrictExpr(t.llmConfig.SystemPrompt) {
		evaluated, err := utils.EvaluateString(t.llmConfig.SystemPrompt, nil, state)
		if err != nil {
			return fmt.Errorf("error evaluating system_prompt expression: %w", err)
		}
		if evaluatedStr, ok := evaluated.(string); ok {
			t.llmConfig.SystemPrompt = evaluatedStr
		}
	}

	logger.Debug("LLM task expressions evaluated successfully")
	return nil
}

func (t *CallLlmTaskBuilder) evaluateTaskArguments(ctx workflow.Context, state *utils.State) (*model.CallFunction, error) {
	return t.task, nil
}
