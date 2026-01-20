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
	"slices"

	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// evaluateRunTaskExpressions evaluates all expressions in a Run task configuration
// This includes script/shell commands, arguments, and environment variables
func evaluateRunTaskExpressions(ctx workflow.Context, task *model.RunTask, state *utils.State) error {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Evaluating Run task expressions with direct field access")

	// Evaluate Script task fields
	if task.Run.Script != nil {
		// 1. Evaluate InlineCode if it contains an expression
		if task.Run.Script.InlineCode != nil && *task.Run.Script.InlineCode != "" {
			if model.IsStrictExpr(*task.Run.Script.InlineCode) {
				evaluated, err := utils.EvaluateString(*task.Run.Script.InlineCode, nil, state)
				if err != nil {
					return fmt.Errorf("error evaluating script inline code: %w", err)
				}
				evalStr := evaluated.(string)
				task.Run.Script.InlineCode = &evalStr
			}
		}

		// 2. Evaluate Arguments
		if task.Run.Script.Arguments != nil {
			if err := evaluateRunArguments(task.Run.Script.Arguments, state); err != nil {
				return fmt.Errorf("error evaluating script arguments: %w", err)
			}
		}

		// 3. Evaluate Environment variables
		if err := evaluateEnvironmentVariables(task.Run.Script.Environment, state); err != nil {
			return fmt.Errorf("error evaluating script environment: %w", err)
		}
	}

	// Evaluate Shell task fields
	if task.Run.Shell != nil {
		// 1. Evaluate Command if it contains an expression
		if task.Run.Shell.Command != "" {
			if model.IsStrictExpr(task.Run.Shell.Command) {
				evaluated, err := utils.EvaluateString(task.Run.Shell.Command, nil, state)
				if err != nil {
					return fmt.Errorf("error evaluating shell command: %w", err)
				}
				task.Run.Shell.Command = evaluated.(string)
			}
		}

		// 2. Evaluate Arguments
		if task.Run.Shell.Arguments != nil {
			if err := evaluateRunArguments(task.Run.Shell.Arguments, state); err != nil {
				return fmt.Errorf("error evaluating shell arguments: %w", err)
			}
		}

		// 3. Evaluate Environment variables
		if err := evaluateEnvironmentVariables(task.Run.Shell.Environment, state); err != nil {
			return fmt.Errorf("error evaluating shell environment: %w", err)
		}
	}

	return nil
}

// evaluateRunArguments evaluates expressions in RunArguments
func evaluateRunArguments(args *model.RunArguments, state *utils.State) error {
	if args == nil || args.Value == nil {
		return nil
	}

	// RunArguments.Value can be a map, slice, or other type
	// Evaluate using TraverseAndEvaluateObj which handles all cases
	evaluated, err := utils.TraverseAndEvaluateObj(
		model.NewObjectOrRuntimeExpr(args.Value),
		nil,
		state,
	)
	if err != nil {
		return err
	}

	// Update the arguments with evaluated values
	args.Value = evaluated

	return nil
}

// evaluateEnvironmentVariables evaluates expressions in environment variable map
func evaluateEnvironmentVariables(env map[string]string, state *utils.State) error {
	if len(env) == 0 {
		return nil
	}

	for key, value := range env {
		if model.IsStrictExpr(value) {
			evaluated, err := utils.EvaluateString(value, nil, state)
			if err != nil {
				return err
			}
			env[key] = evaluated.(string)
		}
	}

	return nil
}

func NewRunTaskBuilder(
	temporalWorker worker.Worker,
	task *model.RunTask,
	taskName string,
	doc *model.Workflow,
) (*RunTaskBuilder, error) {
	return &RunTaskBuilder{
		builder: builder[*model.RunTask]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

type RunTaskBuilder struct {
	builder[*model.RunTask]
}

func (t *RunTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	if t.task.Run.Await == nil {
		// Default to true
		t.task.Run.Await = utils.Ptr(true)
	}

	var factory TemporalWorkflowFunc
	if s := t.task.Run.Script; s != nil {
		if !slices.Contains([]string{"js", "python"}, s.Language) {
			return nil, fmt.Errorf("unknown script language '%s' for task: %s", s.Language, t.GetTaskName())
		}
		if t.task.Run.Await != nil && !*t.task.Run.Await {
			return nil, fmt.Errorf("run scripts must be run with await: %s", t.GetTaskName())
		}
		if s.InlineCode == nil || *s.InlineCode == "" {
			return nil, fmt.Errorf("run script has no code defined: %s", t.GetTaskName())
		}
		factory = t.runScript
	} else if t.task.Run.Shell != nil {
		factory = t.runShell
	} else if t.task.Run.Workflow != nil {
		factory = t.runWorkflow
	} else {
		return nil, fmt.Errorf("unsupported run task: %s", t.GetTaskName())
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)
		awaitVal := false
		if t.task.Run.Await != nil {
			awaitVal = *t.task.Run.Await
		}
		logger.Debug("Run await status", "await", awaitVal, "task", t.GetTaskName())

		res, err := factory(ctx, input, state)
		if err != nil {
			return nil, err
		}

		// Add the result to the state's data
		logger.Debug("Setting data to the state", "key", t.name)
		state.AddData(map[string]any{
			t.name: res,
		})

		return res, nil
	}, nil
}

func (t *RunTaskBuilder) executeCommand(ctx workflow.Context, activityFn, input any, state *utils.State) (any, error) {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Executing a command", "task", t.GetTaskName())

	// Evaluate task arguments in workflow context before scheduling activity
	evaluatedTask, err := t.evaluateTaskArguments(ctx, state)
	if err != nil {
		logger.Error("Error evaluating task arguments", "name", t.name, "error", err)
		return nil, fmt.Errorf("error evaluating task arguments: %w", err)
	}

	// Pass runtime environment to activity for JIT secret resolution
	var res any
	if err := workflow.ExecuteActivity(ctx, activityFn, evaluatedTask, input, state.Env).Get(ctx, &res); err != nil {
		if temporal.IsCanceledError(err) {
			return nil, nil
		}

		logger.Error("Error calling executing command task", "name", t.name, "error", err)
		return nil, fmt.Errorf("error calling executing command task: %w", err)
	}

	return res, nil
}

func (t *RunTaskBuilder) runScript(ctx workflow.Context, input any, state *utils.State) (any, error) {
	return t.executeCommand(ctx, (*RunActivities).CallScriptActivity, input, state)
}

func (t *RunTaskBuilder) runShell(ctx workflow.Context, input any, state *utils.State) (any, error) {
	return t.executeCommand(ctx, (*RunActivities).CallShellActivity, input, state)
}

func (t *RunTaskBuilder) runWorkflow(ctx workflow.Context, input any, state *utils.State) (any, error) {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Running a child workflow", "task", t.GetTaskName())

	await := true
	if t.task.Run.Await != nil {
		await = *t.task.Run.Await
	}

	opts := workflow.ChildWorkflowOptions{}
	if !await {
		opts.ParentClosePolicy = enums.PARENT_CLOSE_POLICY_ABANDON
	}

	ctx = workflow.WithChildOptions(ctx, opts)

	future := workflow.ExecuteChildWorkflow(ctx, t.task.Run.Workflow.Name, input, state)

	if !await {
		logger.Warn("Not waiting for child workspace response", "task", t.GetTaskName())
		return nil, nil
	}

	var res any
	if err := future.Get(ctx, &res); err != nil {
		logger.Error("Error executiing child workflow", "error", err)
		return nil, fmt.Errorf("error executiing child workflow: %w", err)
	}
	logger.Debug("Child workflow completed", "task", t.GetTaskName())

	return res, nil
}
