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
	"github.com/rs/zerolog/log"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func NewTryTaskBuilder(
	temporalWorker worker.Worker,
	task *model.TryTask,
	taskName string,
	doc *model.Workflow,
) (*TryTaskBuilder, error) {
	return &TryTaskBuilder{
		builder: builder[*model.TryTask]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

type TryTaskBuilder struct {
	builder[*model.TryTask]

	tryChildWorkflowFunc  TemporalWorkflowFunc
	catchChildWorkflowFunc TemporalWorkflowFunc
}

func (t *TryTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	for taskType, list := range t.getTasks() {
		_, builder, err := t.createBuilder(taskType, list)
		if err != nil {
			return nil, fmt.Errorf("erroring registering %s tasks for %s: %w", taskType, t.GetTaskName(), err)
		}

		// Skip if builder is nil (no tasks to build)
		if builder == nil {
			continue
		}

		wf, err := builder.Build()
		if err != nil {
			log.Error().Str("task", t.GetTaskName()).Str("taskType", taskType).Msg("Error building for workflow")
			return nil, fmt.Errorf("error building for workflow: %w", err)
		}

		// Store the workflow function for inline execution
		// We don't use child workflows because they require pre-registration
		// Instead, we execute the do tasks inline within the same workflow
		if taskType == "try" {
			t.tryChildWorkflowFunc = wf
		} else {
			t.catchChildWorkflowFunc = wf
		}
	}

	return t.exec()
}

func (t *TryTaskBuilder) PostLoad() error {
	for taskType, list := range t.getTasks() {
		_, builder, err := t.createBuilder(taskType, list)
		if err != nil {
			return fmt.Errorf("erroring registering %s post load tasks for %s: %w", taskType, t.GetTaskName(), err)
		}

		// Skip if builder is nil (no tasks to build)
		if builder == nil {
			continue
		}

		if err = builder.PostLoad(); err != nil {
			log.Error().Str("task", t.GetTaskName()).Str("taskType", taskType).Msg("Error building for workflow")
			return fmt.Errorf("error building for post load workflow: %w", err)
		}
	}

	return nil
}

func (t *TryTaskBuilder) exec() (TemporalWorkflowFunc, error) {
	return func(ctx workflow.Context, input any, state *utils.State) (output any, err error) {
		logger := workflow.GetLogger(ctx)

		// Execute the try workflow function inline
		if t.tryChildWorkflowFunc != nil {
			res, err := t.tryChildWorkflowFunc(ctx, state.Input, state)
			if err != nil {
				logger.Warn("Try workflow failed, executing catch workflow", "task", t.GetTaskName(), "error", err)
				
				// The try workflow has failed - let's run the catch workflow
				if t.catchChildWorkflowFunc != nil {
					res, err := t.catchChildWorkflowFunc(ctx, state.Input, state)
					if err != nil {
						logger.Error("Catch workflow also failed", "task", t.GetTaskName(), "error", err)
						return nil, fmt.Errorf("error executing catch workflow: %w", err)
					}
					return res, nil
				}
				
				// No catch workflow defined, return the error
				return nil, err
			}
			return res, nil
		}

		logger.Warn("No try workflow function defined", "task", t.GetTaskName())
		return nil, nil
	}, nil
}

func (t *TryTaskBuilder) getTasks() map[string]*model.TaskList {
	var catchDo *model.TaskList
	if t.task.Catch != nil {
		catchDo = t.task.Catch.Do
	}
	return map[string]*model.TaskList{
		"try":   t.task.Try,
		"catch": catchDo,
	}
}

func (t *TryTaskBuilder) createBuilder(
	taskType string, list *model.TaskList,
) (childWorkflowName string, builder TaskBuilder, err error) {
	l := log.With().Str("task", t.GetTaskName()).Str("taskType", taskType).Logger()

	if list == nil || len(*list) == 0 {
		l.Warn().Msg("No tasks detected")
		return
	}

	childWorkflowName = utils.GenerateChildWorkflowName(taskType, t.GetTaskName())

	// Create DoTaskBuilder with registration disabled - try task will handle it
	b, err := NewDoTaskBuilder(t.temporalWorker, &model.DoTask{Do: list}, childWorkflowName, t.doc, DoTaskOpts{
		DisableRegisterWorkflow: true,
	})
	if err != nil {
		l.Error().Msg("Error creating the DoTask builder")
		err = fmt.Errorf("error creating the DoTask builder: %w", err)
		return
	}

	builder = b

	return
}
