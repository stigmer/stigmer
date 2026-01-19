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
	"maps"

	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"github.com/rs/zerolog/log"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func NewForkTaskBuilder(
	temporalWorker worker.Worker,
	task *model.ForkTask,
	taskName string,
	doc *model.Workflow,
) (*ForkTaskBuilder, error) {
	return &ForkTaskBuilder{
		builder: builder[*model.ForkTask]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

type ForkTaskBuilder struct {
	builder[*model.ForkTask]
}

type forkedTask struct {
	task              *model.TaskItem
	childWorkflowName string
	childWorkflowFunc TemporalWorkflowFunc
	taskName          string
}

func (t *ForkTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	forkedTasks, builders, err := t.buildOrPostLoad()
	if err != nil {
		return nil, err
	}

	// Build workflow functions for inline execution
	// We don't use child workflows because they require pre-registration
	// Instead, we execute the branches inline within the same workflow
	for i, builder := range builders {
		wf, err := builder.Build()
		if err != nil {
			log.Error().Err(err).Msg("Error building forked workflow")
			return nil, fmt.Errorf("error building forked workflow: %w", err)
		}

		// Store the workflow function for inline execution
		forkedTasks[i].childWorkflowFunc = wf
	}

	return t.exec(forkedTasks)
}

func (t *ForkTaskBuilder) PostLoad() error {
	_, builders, err := t.buildOrPostLoad()
	if err != nil {
		return err
	}

	// During PostLoad, only call PostLoad on children for validation
	for _, builder := range builders {
		if err := builder.PostLoad(); err != nil {
			log.Error().Err(err).Msg("Error post loading forked workflow")
			return fmt.Errorf("error post loading forked workflow: %w", err)
		}
	}

	return nil
}

func (t *ForkTaskBuilder) buildOrPostLoad() ([]*forkedTask, []TaskBuilder, error) {
	forkedTasks := make([]*forkedTask, 0)
	builders := make([]TaskBuilder, 0)

	if t.task.Fork.Branches == nil || len(*t.task.Fork.Branches) == 0 {
		log.Warn().Str("task", t.GetTaskName()).Msg("No branches defined in fork task")
		return nil, nil, fmt.Errorf("no branches defined for fork task: %s", t.GetTaskName())
	}

	for _, branch := range *t.task.Fork.Branches {
		childWorkflowName := utils.GenerateChildWorkflowName("fork", t.GetTaskName(), branch.Key)

		forkedTasks = append(forkedTasks, &forkedTask{
			task:              branch,
			childWorkflowName: childWorkflowName,
			taskName:          branch.Key,
		})

		var builder TaskBuilder
		var err error

		if d := branch.AsDoTask(); d == nil {
			// Single task - wrap it in a DoTask
			log.Debug().Str("task", branch.Key).Msg("Wrapping single task in DoTask")
			branch = &model.TaskItem{
				Key: childWorkflowName,
				Task: &model.DoTask{
					Do: &model.TaskList{branch},
				},
			}
			// Create DoTaskBuilder with registration disabled - fork will handle it
			builder, err = NewDoTaskBuilder(t.temporalWorker, branch.Task.(*model.DoTask), childWorkflowName, t.doc, DoTaskOpts{
				DisableRegisterWorkflow: true,
			})
		} else {
			// Branch is already a DoTask - disable its internal workflow registration
			// The fork builder will handle registration during Build()
			log.Debug().Str("task", branch.Key).Msg("Branch is already a DoTask, disabling internal registration")
			builder, err = NewDoTaskBuilder(t.temporalWorker, d, childWorkflowName, t.doc, DoTaskOpts{
				DisableRegisterWorkflow: true,
			})
		}

		if err != nil {
			log.Error().Err(err).Msg("Error creating the forked task builder")
			return nil, nil, fmt.Errorf("error creating the forked task builder: %w", err)
		}

		builders = append(builders, builder)
	}

	return forkedTasks, builders, nil
}

func (t *ForkTaskBuilder) exec(forkedTasks []*forkedTask) (TemporalWorkflowFunc, error) {
	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		isCompeting := t.task.Fork.Compete

		logger := workflow.GetLogger(ctx)
		logger.Debug("Forking a task", "isCompeting", isCompeting)

		// Create channels to collect results from parallel branches
		type branchResult struct {
			taskName string
			data     any
			err      error
		}

		resultChan := workflow.NewChannel(ctx)
		cancelChan := workflow.NewChannel(ctx)

		// Create a new state with no output to pass to the children
		childState := state.Clone().ClearOutput()
		output := map[string]any{}

		// Execute branches inline in parallel
		for _, branch := range forkedTasks {
			b := branch // capture loop variable
			logger.Debug("Executing forked branch inline", "name", b.taskName)

			// Execute each branch as a goroutine
			workflow.Go(ctx, func(ctx workflow.Context) {
				ctx, cancelHandler := workflow.WithCancel(ctx)

				// Listen for cancellation signals
				workflow.Go(ctx, func(ctx workflow.Context) {
					var signal string
					cancelChan.Receive(ctx, &signal)
					if signal == b.taskName {
						logger.Debug("Cancelling forked branch", "task", b.taskName)
						cancelHandler()
					}
				})

				// Execute the branch function inline
				branchState := childState.Clone()
				res, err := b.childWorkflowFunc(ctx, input, branchState)

				// Send result back
				resultChan.Send(ctx, branchResult{
					taskName: b.taskName,
					data:     res,
					err:      err,
				})
			})
		}

		// Collect results from all branches
		var replyErr error
		completedCount := 0
		totalBranches := len(forkedTasks)
		var winningTask string

		for completedCount < totalBranches {
			var result branchResult
			resultChan.Receive(ctx, &result)
			completedCount++

			if result.err != nil {
				if temporal.IsCanceledError(result.err) {
					logger.Debug("Forked branch cancelled", "task", result.taskName)
					continue
				}

				logger.Error("Error executing forked branch", "error", result.err, "task", result.taskName)
				replyErr = fmt.Errorf("error executing forked branch %s: %w", result.taskName, result.err)
				break
			}

			logger.Debug("Forked branch completed", "task", result.taskName)

			// Handle competing vs non-competing modes
			if isCompeting && winningTask == "" {
				// First branch to complete wins
				logger.Debug("Winner declared", "task", result.taskName)
				winningTask = result.taskName
				maps.Copy(output, result.data.(map[string]any))

				// Cancel all other branches
				for _, branch := range forkedTasks {
					if branch.taskName != winningTask {
						cancelChan.Send(ctx, branch.taskName)
					}
				}
			} else if !isCompeting {
				// All branches contribute to output
				output[result.taskName] = result.data
			}
		}

		logger.Debug("Forked task has completed", "completedCount", completedCount)

		if replyErr != nil {
			return nil, replyErr
		}

		return output, nil
	}, nil
}
