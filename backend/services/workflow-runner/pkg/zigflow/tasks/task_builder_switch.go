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
	"fmt"

	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func NewSwitchTaskBuilder(
	temporalWorker worker.Worker,
	task *model.SwitchTask,
	taskName string,
	doc *model.Workflow,
) (*SwitchTaskBuilder, error) {
	return &SwitchTaskBuilder{
		builder: builder[*model.SwitchTask]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

type SwitchTaskBuilder struct {
	builder[*model.SwitchTask]
}

func (t *SwitchTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	hasDefault := false
	for i, switchItem := range t.task.Switch {
		for name, item := range switchItem {
			if item.When == nil {
				if hasDefault {
					return nil, fmt.Errorf("multiple switch statements without when: %s.%d.%s", t.GetTaskName(), i, name)
				}
				hasDefault = true
			}
		}
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		for _, switchItem := range t.task.Switch {
			for name, item := range switchItem {
				logger.Debug("Checking if we should run this switch statement", "task", t.GetTaskName(), "condition", name)

				if shouldRun, err := utils.CheckIfStatement(item.When, state); err != nil {
					return nil, err
				} else if !shouldRun {
					logger.Debug("Skipping switch statement task", "task", t.GetTaskName(), "condition", name)
					continue
				}

				then := item.Then
				if then == nil || then.IsTermination() {
					logger.Debug("Skipping task as then is termination or not set")
					return nil, nil
				}

				// Check if this is a task reference (inline task in do:) or a child workflow
				targetTask := then.Value
				
				// Try to check if it's a task in the current workflow's do: list
				// If so, we'll set the base task's Then directive to jump to that task
				// Otherwise, fall back to child workflow execution
				
				logger.Info("Switch matched condition", "task", t.GetTaskName(), "condition", name, "target", targetTask)
				
				// Set the task base's Then directive so the Do builder can handle flow control
				// This is the key: we're setting it on the base task so handleFlowDirective picks it up
				if t.GetTask() != nil && t.GetTask().GetBase() != nil {
					t.GetTask().GetBase().Then = then
					logger.Debug("Set task Then directive for flow control", "target", targetTask)
					// Return nil to let the Do builder handle the flow
					return nil, nil
				}
				
				// Fallback: Try executing as child workflow (for backward compatibility)
				logger.Info("Executing switch target as child workflow", "target", targetTask)
				var res any
				if err := workflow.ExecuteChildWorkflow(ctx, targetTask, input, state).Get(ctx, &res); err != nil {
					logger.Error("Error executing child workflow", "task", t.GetTaskName(), "target", targetTask, "error", err)
					return nil, err
				}

				// Stop it executing anything else
				return nil, nil
			}
		}

		return nil, nil
	}, nil
}
