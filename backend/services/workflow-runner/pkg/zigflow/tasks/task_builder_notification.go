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

// NotificationTaskBuilder handles notification tasks that send fire-and-forget
// messages to humans through channels like Slack, email, or webhooks.
type NotificationTaskBuilder struct {
	builder[*model.CallFunction]
	config *workflowtasks.NotificationTaskConfig
}

func NewNotificationTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallFunction,
	taskName string,
	doc *model.Workflow,
) (*NotificationTaskBuilder, error) {
	if task.Call != customCallFunctionNotification {
		return nil, fmt.Errorf("unsupported call type '%s' for notification builder", task.Call)
	}
	return &NotificationTaskBuilder{
		builder: builder[*model.CallFunction]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

func (t *NotificationTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	log.Debug().Str("task", t.GetTaskName()).Msg("Building notification task")

	if err := t.parseConfig(); err != nil {
		return nil, err
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		logger.Info("Executing notification activity",
			"channel", t.config.Channel,
			"task", t.GetTaskName())

		var res any
		if err := workflow.ExecuteActivity(ctx, (*NotificationActivities).NotificationActivity,
			t.config, input, state.Env).Get(ctx, &res); err != nil {
			return nil, fmt.Errorf("notification activity failed: %w", err)
		}

		state.AddData(map[string]any{t.GetTaskName(): res})
		return res, nil
	}, nil
}

func (t *NotificationTaskBuilder) parseConfig() error {
	withBytes, err := json.Marshal(t.task.With)
	if err != nil {
		return fmt.Errorf("failed to marshal task.With: %w", err)
	}

	t.config = &workflowtasks.NotificationTaskConfig{}
	if err := protojson.Unmarshal(withBytes, t.config); err != nil {
		return fmt.Errorf("failed to unmarshal notification config: %w", err)
	}

	if t.config.Channel == "" {
		return fmt.Errorf("channel field is required in notification config")
	}
	if t.config.Body == "" {
		return fmt.Errorf("body field is required in notification config")
	}
	if len(t.config.Recipients) == 0 {
		return fmt.Errorf("at least one recipient is required in notification config")
	}

	log.Debug().
		Str("task", t.GetTaskName()).
		Str("channel", t.config.Channel).
		Msg("Notification config parsed")

	return nil
}

var _ TaskBuilder = &NotificationTaskBuilder{}
