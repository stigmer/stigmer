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

// EmitEventTaskBuilder handles emit_event tasks that publish CloudEvents.
type EmitEventTaskBuilder struct {
	builder[*model.CallFunction]
	config *workflowtasks.EmitEventTaskConfig
}

func NewEmitEventTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallFunction,
	taskName string,
	doc *model.Workflow,
) (*EmitEventTaskBuilder, error) {
	if task.Call != customCallFunctionEmitEvent {
		return nil, fmt.Errorf("unsupported call type '%s' for emit_event builder", task.Call)
	}
	return &EmitEventTaskBuilder{
		builder: builder[*model.CallFunction]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

func (t *EmitEventTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	log.Debug().Str("task", t.GetTaskName()).Msg("Building emit_event task")

	if err := t.parseConfig(); err != nil {
		return nil, err
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		logger.Info("Executing emit_event activity",
			"event_type", t.config.Event.Type,
			"task", t.GetTaskName())

		executionID := getExecutionIdFromState(state)

		var res any
		if err := workflow.ExecuteActivity(ctx, (*EmitEventActivities).EmitEventActivity,
			t.config, executionID, state.Env).Get(ctx, &res); err != nil {
			return nil, fmt.Errorf("emit_event activity failed: %w", err)
		}

		state.AddData(map[string]any{t.GetTaskName(): res})
		return res, nil
	}, nil
}

func (t *EmitEventTaskBuilder) parseConfig() error {
	withBytes, err := json.Marshal(t.task.With)
	if err != nil {
		return fmt.Errorf("failed to marshal task.With: %w", err)
	}

	t.config = &workflowtasks.EmitEventTaskConfig{}
	if err := protojson.Unmarshal(withBytes, t.config); err != nil {
		return fmt.Errorf("failed to unmarshal emit_event config: %w", err)
	}

	if t.config.Event == nil {
		return fmt.Errorf("event field is required in emit_event config")
	}
	if t.config.Event.Type == "" {
		return fmt.Errorf("event.type field is required in emit_event config")
	}

	log.Debug().
		Str("task", t.GetTaskName()).
		Str("event_type", t.config.Event.Type).
		Msg("Emit event config parsed")

	return nil
}

var _ TaskBuilder = &EmitEventTaskBuilder{}
