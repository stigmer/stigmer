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

// EvalTaskBuilder handles eval tasks that use an LLM judge to assess
// the semantic quality of workflow data.
type EvalTaskBuilder struct {
	builder[*model.CallFunction]
	config *workflowtasks.EvalTaskConfig
}

func NewEvalTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallFunction,
	taskName string,
	doc *model.Workflow,
) (*EvalTaskBuilder, error) {
	if task.Call != customCallFunctionEval {
		return nil, fmt.Errorf("unsupported call type '%s' for eval builder", task.Call)
	}
	return &EvalTaskBuilder{
		builder: builder[*model.CallFunction]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

func (t *EvalTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	log.Debug().Str("task", t.GetTaskName()).Msg("Building eval task")

	if err := t.parseConfig(); err != nil {
		return nil, err
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		subject, err := t.resolveSubject(state)
		if err != nil {
			logger.Error("Error resolving eval subject", "error", err)
			return nil, fmt.Errorf("error resolving eval subject: %w", err)
		}

		if err := t.evaluateExpressions(ctx, state); err != nil {
			logger.Error("Error evaluating eval task expressions", "error", err)
			return nil, fmt.Errorf("error evaluating eval task expressions: %w", err)
		}

		workflowExecutionId := workflow.GetInfo(ctx).WorkflowExecution.ID

		logger.Info("Executing eval activity",
			"model", t.config.Model,
			"scoring_mode", t.config.ScoringMode.String(),
			"task", t.GetTaskName())

		var res any
		if err := workflow.ExecuteActivity(ctx, (*EvalActivities).EvalActivity,
			t.config, subject, workflowExecutionId).Get(ctx, &res); err != nil {
			return nil, fmt.Errorf("eval activity failed: %w", err)
		}

		state.AddData(map[string]any{t.GetTaskName(): res})
		return res, nil
	}, nil
}

func (t *EvalTaskBuilder) parseConfig() error {
	withBytes, err := json.Marshal(t.task.With)
	if err != nil {
		return fmt.Errorf("failed to marshal task.With: %w", err)
	}

	t.config = &workflowtasks.EvalTaskConfig{}
	if err := protojson.Unmarshal(withBytes, t.config); err != nil {
		return fmt.Errorf("failed to unmarshal eval config: %w", err)
	}

	if t.config.Model == "" {
		return fmt.Errorf("model field is required in eval config")
	}
	if t.config.Subject == "" {
		return fmt.Errorf("subject field is required in eval config")
	}
	if t.config.Rubric == "" {
		return fmt.Errorf("rubric field is required in eval config")
	}

	if t.config.ScoringMode == workflowtasks.EvalScoringMode_EVAL_MULTI_CRITERIA && len(t.config.Criteria) == 0 {
		return fmt.Errorf("criteria field is required when scoring_mode is EVAL_MULTI_CRITERIA")
	}

	if t.config.Threshold == 0 && t.config.ScoringMode != workflowtasks.EvalScoringMode_EVAL_PASS_FAIL {
		t.config.Threshold = 0.5
	}

	log.Debug().
		Str("task", t.GetTaskName()).
		Str("model", t.config.Model).
		Str("scoring_mode", t.config.ScoringMode.String()).
		Msg("Eval config parsed")
	return nil
}

func (t *EvalTaskBuilder) resolveSubject(state *utils.State) (any, error) {
	evaluated, err := utils.EvaluateString(t.config.Subject, nil, state)
	if err != nil {
		return nil, fmt.Errorf("error evaluating eval subject: %w", err)
	}
	return evaluated, nil
}

func (t *EvalTaskBuilder) evaluateExpressions(ctx workflow.Context, state *utils.State) error {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Evaluating eval task expressions in workflow context")

	if t.config.SystemPrompt != "" && model.IsStrictExpr(t.config.SystemPrompt) {
		evaluated, err := utils.EvaluateString(t.config.SystemPrompt, nil, state)
		if err != nil {
			return fmt.Errorf("error evaluating system_prompt expression: %w", err)
		}
		if evaluatedStr, ok := evaluated.(string); ok {
			t.config.SystemPrompt = evaluatedStr
		}
	}

	return nil
}

var _ TaskBuilder = &EvalTaskBuilder{}
