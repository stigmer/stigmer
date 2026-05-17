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
	"time"

	"github.com/rs/zerolog/log"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/encoding/protojson"
)

// SignalHumanInputPrefix is prepended to the task name to form the Temporal
// signal name for human_input tasks.
const SignalHumanInputPrefix = "human_input_"

// HumanInputSignalPayload is the structure received when a reviewer responds.
type HumanInputSignalPayload struct {
	Outcome     string         `json:"outcome"`
	FormData    map[string]any `json:"form_data,omitempty"`
	Reviewer    string         `json:"reviewer"`
	RespondedAt string         `json:"responded_at"`
}

// HumanInputTaskBuilder handles human_input tasks that pause workflow
// execution to collect approval or typed input from a human reviewer.
//
// Unlike other task types, human_input does NOT use an activity. It uses
// Temporal signals directly in the workflow function because:
//   - Signals are durable (survive workflow restarts)
//   - No worker thread is blocked
//   - Timeout is handled by Temporal's timer
type HumanInputTaskBuilder struct {
	builder[*model.CallFunction]
	config *workflowtasks.HumanInputTaskConfig
}

func NewHumanInputTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallFunction,
	taskName string,
	doc *model.Workflow,
) (*HumanInputTaskBuilder, error) {
	if task.Call != customCallFunctionHumanInput {
		return nil, fmt.Errorf("unsupported call type '%s' for human_input builder", task.Call)
	}
	return &HumanInputTaskBuilder{
		builder: builder[*model.CallFunction]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

func (t *HumanInputTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	log.Debug().Str("task", t.GetTaskName()).Msg("Building human_input task")

	if err := t.parseConfig(); err != nil {
		return nil, err
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		if err := t.evaluateExpressions(ctx, state); err != nil {
			logger.Error("Error evaluating human_input expressions", "error", err)
			return nil, fmt.Errorf("error evaluating human_input expressions: %w", err)
		}

		signalName := SignalHumanInputPrefix + t.GetTaskName()
		signalCh := workflow.GetSignalChannel(ctx, signalName)

		logger.Info("Human input gate activated, waiting for signal",
			"task", t.GetTaskName(),
			"signal", signalName,
			"timeout", t.config.Timeout)

		var payload HumanInputSignalPayload
		received := false

		if t.config.Timeout > 0 {
			timerCtx, cancelTimer := workflow.WithCancel(ctx)
			timerFuture := workflow.NewTimer(timerCtx, time.Duration(t.config.Timeout)*time.Second)

			selector := workflow.NewNamedSelector(ctx, "human-input-or-timeout")

			selector.AddReceive(signalCh, func(c workflow.ReceiveChannel, more bool) {
				c.Receive(ctx, &payload)
				received = true
				cancelTimer()
			})

			selector.AddFuture(timerFuture, func(f workflow.Future) {
				// Timer fired — timeout
			})

			selector.Select(ctx)
		} else {
			signalCh.Receive(ctx, &payload)
			received = true
		}

		if !received {
			return t.handleTimeout(state)
		}

		return t.buildOutput(payload, state)
	}, nil
}

func (t *HumanInputTaskBuilder) handleTimeout(state *utils.State) (any, error) {
	policy := t.config.OnTimeout
	if policy == workflowtasks.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_POLICY_UNSPECIFIED {
		policy = workflowtasks.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_FAIL
	}

	switch policy {
	case workflowtasks.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_FAIL:
		return nil, fmt.Errorf("human_input task '%s' timed out after %d seconds", t.GetTaskName(), t.config.Timeout)

	case workflowtasks.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_APPROVE:
		outcome := "approve"
		if len(t.config.Outcomes) > 0 {
			outcome = t.config.Outcomes[0].Name
		}
		return map[string]any{
			"outcome":       outcome,
			"auto_resolved": true,
			"reason":        "timeout",
		}, nil

	case workflowtasks.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_DENY:
		outcome := "deny"
		if len(t.config.Outcomes) > 0 {
			outcome = t.config.Outcomes[len(t.config.Outcomes)-1].Name
		}
		return map[string]any{
			"outcome":       outcome,
			"auto_resolved": true,
			"reason":        "timeout",
		}, nil

	case workflowtasks.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_ESCALATE:
		return nil, fmt.Errorf("human_input task '%s' timed out and escalation is configured but not yet implemented", t.GetTaskName())

	default:
		return nil, fmt.Errorf("human_input task '%s' timed out (unknown policy)", t.GetTaskName())
	}
}

func (t *HumanInputTaskBuilder) buildOutput(payload HumanInputSignalPayload, state *utils.State) (any, error) {
	output := map[string]any{
		"outcome":      payload.Outcome,
		"reviewer":     payload.Reviewer,
		"responded_at": payload.RespondedAt,
	}

	if payload.FormData != nil {
		output["form_data"] = payload.FormData
	}

	// Route based on outcome if custom outcomes with `then` are defined
	for _, o := range t.config.Outcomes {
		if o.Name == payload.Outcome && o.Then != "" {
			output["__stigmer_branch_override"] = o.Then
			break
		}
	}

	// For binary approve/deny: deny without custom outcomes fails the task
	if len(t.config.Outcomes) == 0 && payload.Outcome == "deny" {
		return nil, fmt.Errorf("human_input task '%s' was denied", t.GetTaskName())
	}

	return output, nil
}

func (t *HumanInputTaskBuilder) parseConfig() error {
	withBytes, err := json.Marshal(t.task.With)
	if err != nil {
		return fmt.Errorf("failed to marshal task.With: %w", err)
	}

	t.config = &workflowtasks.HumanInputTaskConfig{}
	if err := protojson.Unmarshal(withBytes, t.config); err != nil {
		return fmt.Errorf("failed to unmarshal human_input config: %w", err)
	}

	if t.config.Prompt == "" {
		return fmt.Errorf("prompt field is required in human_input config")
	}

	log.Debug().
		Str("task", t.GetTaskName()).
		Int("outcomes", len(t.config.Outcomes)).
		Int32("timeout", t.config.Timeout).
		Msg("Human input config parsed")

	return nil
}

func (t *HumanInputTaskBuilder) evaluateExpressions(ctx workflow.Context, state *utils.State) error {
	if model.IsStrictExpr(t.config.Prompt) {
		evaluated, err := utils.EvaluateString(t.config.Prompt, nil, state)
		if err != nil {
			return fmt.Errorf("error evaluating prompt expression: %w", err)
		}
		if s, ok := evaluated.(string); ok {
			t.config.Prompt = s
		}
	}
	return nil
}

var _ TaskBuilder = &HumanInputTaskBuilder{}
