/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/graphs/contributors>
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

	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/claimcheck"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/utils"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/zigflow/metadata"
	"github.com/rs/zerolog/log"
	swUtils "github.com/serverlessworkflow/sdk-go/v3/impl/utils"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

var activitiesRegistry []any = make([]any, 0)

func ActivitiesList() []any {
	return activitiesRegistry
}

type TaskBuilder interface {
	Build() (TemporalWorkflowFunc, error)
	GetTask() model.Task
	GetTaskName() string
	NeverSkipCAN() bool
	ParseMetadata(workflow.Context, *utils.State) error
	PostLoad() error
	ShouldRun(*utils.State) (bool, error)
}

type TemporalWorkflowFunc func(ctx workflow.Context, input any, state *utils.State) (output any, err error)

type builder[T model.Task] struct {
	doc            *model.Workflow
	name           string
	neverSkipCAN   bool
	task           T
	temporalWorker worker.Worker
}

func (d *builder[T]) executeActivity(ctx workflow.Context, activity, input any, state *utils.State) (output any, err error) {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Calling activity", "name", d.name)

	// Store current task name in state for progress interceptor access
	// This allows the interceptor to report the user-defined task name instead of the activity type
	state.AddData(map[string]interface{}{
		"__stigmer_current_task_name": d.name,
	})

	// Phase 4+: Auto-retrieve any ClaimCheckRefs in state before evaluating expressions
	// This ensures expressions can reference the actual data, not opaque references
	if claimcheck.IsEnabled() {
		logger.Debug("Claim Check enabled - checking for references in state before activity",
			"activity", d.name)

		if err := d.maybeRetrieveStateData(ctx, state); err != nil {
			logger.Warn("Failed to retrieve state data before activity, continuing with original state",
				"activity", d.name,
				"error", err)
			// Don't fail - let activity proceed with original state
		}
	}

	// Evaluate expressions in the workflow context (no size limits here)
	// This prevents the large state from being serialized with activity inputs
	evaluatedTask, err := d.evaluateTaskArguments(ctx, state)
	if err != nil {
		logger.Error("Error evaluating task arguments", "name", d.name, "error", err)
		return nil, fmt.Errorf("error evaluating task arguments: %w", err)
	}

	// Set custom ActivityID to include task name for progress reporting
	// Format: "task-{taskName}-{timestamp}"
	// This allows the progress interceptor to extract the user-defined task name
	activityOpts := workflow.GetActivityOptions(ctx)
	activityOpts.ActivityID = fmt.Sprintf("task-%s-%d", d.name, workflow.Now(ctx).UnixNano())
	ctx = workflow.WithActivityOptions(ctx, activityOpts)

	// Pass evaluated task, input, and runtime environment to activity (NOT the full state)
	// The activity receives concrete values, not expressions requiring evaluation
	// Runtime environment is passed separately for JIT secret resolution in activities
	var res any
	if err := workflow.ExecuteActivity(ctx, activity, evaluatedTask, input, state.Env).Get(ctx, &res); err != nil {
		if temporal.IsCanceledError(err) {
			return nil, nil
		}

		logger.Error("Error calling activity", "name", d.name, "error", err)
		return nil, fmt.Errorf("error calling activity: %w", err)
	}

	// Add the result to the state's data
	logger.Debug("Setting data to the state", "key", d.name)
	state.AddData(map[string]any{
		d.name: res,
	})

	return res, nil
}

// evaluateTaskArguments evaluates all expressions in the task configuration
// using the current state. This is done in the workflow context (no size limits)
// before scheduling the activity, preventing large state from being serialized
// with activity inputs.
//
// IMPLEMENTATION NOTE: This function uses direct struct field manipulation instead
// of JSON marshal/unmarshal to avoid SDK unmarshaling issues with complex types
// like Endpoint. Each task type has its own evaluation function that directly
// modifies the struct fields.
func (d *builder[T]) evaluateTaskArguments(ctx workflow.Context, state *utils.State) (T, error) {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Evaluating task expressions in workflow context", "task", d.name)

	// Use type switch to handle each task type with direct field evaluation
	switch task := any(d.task).(type) {
	case *model.CallHTTP:
		// HTTP tasks: evaluate endpoint, headers, query, body
		if err := evaluateHTTPTaskExpressions(ctx, task, state); err != nil {
			return d.task, fmt.Errorf("error evaluating HTTP task expressions: %w", err)
		}
		logger.Debug("HTTP task expressions evaluated successfully", "task", d.name)
		return any(task).(T), nil

	case *model.CallGRPC:
		// gRPC tasks: evaluate service, method, proto endpoint, arguments
		if err := evaluateGRPCTaskExpressions(ctx, task, state); err != nil {
			return d.task, fmt.Errorf("error evaluating gRPC task expressions: %w", err)
		}
		logger.Debug("gRPC task expressions evaluated successfully", "task", d.name)
		return any(task).(T), nil

	default:
		// This should never happen - only CallHTTP and CallGRPC use executeActivity()
		// which calls this function. If we get here, it's a programming error.
		logger.Error("Unexpected task type in evaluateTaskArguments",
			"task", d.name, "type", fmt.Sprintf("%T", d.task))
		return d.task, fmt.Errorf("unsupported task type for expression evaluation: %T", d.task)
	}
}

// maybeRetrieveStateData auto-retrieves any ClaimCheckRefs in state before activity execution
// This ensures activities receive actual data, not opaque references
func (d *builder[T]) maybeRetrieveStateData(ctx workflow.Context, state *utils.State) error {
	logger := workflow.GetLogger(ctx)

	mgr := claimcheck.GetGlobalManager()
	if mgr == nil {
		logger.Debug("Claim check manager not available")
		return nil
	}

	// Retrieve any references in state.Data
	if state.Data != nil {
		retrievedData, err := mgr.MaybeRetrieveStateData(ctx, state.Data)
		if err != nil {
			return fmt.Errorf("failed to retrieve state.Data: %w", err)
		}
		state.Data = retrievedData
	}

	// Also check state.Context
	if state.Context != nil {
		if contextMap, ok := state.Context.(map[string]any); ok {
			retrievedContext, err := mgr.MaybeRetrieveStateData(ctx, contextMap)
			if err != nil {
				logger.Warn("Failed to retrieve state.Context", "error", err)
			} else {
				state.Context = retrievedContext
			}
		}
	}

	return nil
}

func (d *builder[T]) GetTask() model.Task {
	return d.task
}

func (d *builder[T]) GetTaskName() string {
	return d.name
}

// Some tasks should never be skipped when doing Continue-As-New
func (d *builder[T]) NeverSkipCAN() bool {
	return d.neverSkipCAN
}

func (d builder[T]) ParseMetadata(ctx workflow.Context, state *utils.State) error {
	logger := workflow.GetLogger(ctx)

	task := d.GetTask().GetBase()

	if len(task.Metadata) == 0 {
		// No metadata set - continue
		return nil
	}

	// Clone the metadata to avoid pollution
	mClone := swUtils.DeepClone(task.Metadata)

	parsed, err := utils.TraverseAndEvaluateObj(model.NewObjectOrRuntimeExpr(mClone), nil, state)
	if err != nil {
		return fmt.Errorf("error interpolating metadata: %w", err)
	}

	if search, ok := parsed.(map[string]any)[metadata.MetadataSearchAttribute]; ok {
		logger.Debug("Parsing search attributes")
		if err := metadata.ParseSearchAttributes(ctx, search); err != nil {
			logger.Error("Error parsing search attributes", "attributes", search, "error", err)
			return fmt.Errorf("error parsing search attributes: %w", err)
		}
	}

	return nil
}

func (d *builder[T]) PostLoad() error {
	log.Trace().Str("task", d.GetTaskName()).Msg("Task has no post load hook")
	return nil
}

func (d *builder[T]) ShouldRun(state *utils.State) (bool, error) {
	return utils.CheckIfStatement(d.task.GetBase().If, state)
}

// Factory to create a TaskBuilder instance, or die trying
func NewTaskBuilder(taskName string, task model.Task, temporalWorker worker.Worker, doc *model.Workflow) (TaskBuilder, error) {
	switch t := task.(type) {
	case *model.CallFunction:
		if t.Call == customCallFunctionActivity {
			return NewCallActivityTaskBuilder(temporalWorker, t, taskName, doc)
		}
		if t.Call == customCallFunctionAgent {
			return NewCallAgentTaskBuilder(temporalWorker, t, taskName, doc)
		}
		return nil, fmt.Errorf("unsupported call type '%s' for task '%s'", t.Call, taskName)
	case *model.CallGRPC:
		return NewCallGRPCTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.CallHTTP:
		return NewCallHTTPTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.DoTask:
		return NewDoTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.ForTask:
		return NewForTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.ForkTask:
		return NewForkTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.ListenTask:
		return NewListenTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.RaiseTask:
		return NewRaiseTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.RunTask:
		return NewRunTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.SetTask:
		return NewSetTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.SwitchTask:
		return NewSwitchTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.TryTask:
		return NewTryTaskBuilder(temporalWorker, t, taskName, doc)
	case *model.WaitTask:
		return NewWaitTaskBuilder(temporalWorker, t, taskName, doc)
	default:
		return nil, fmt.Errorf("unsupported task type '%T' for task '%s'", t, taskName)
	}
}

// Ensure the tasks meets the TaskBuilder type
var (
	_ TaskBuilder = &CallActivityTaskBuilder{}
	_ TaskBuilder = &CallAgentTaskBuilder{}
	_ TaskBuilder = &CallGRPCTaskBuilder{}
	_ TaskBuilder = &CallHTTPTaskBuilder{}
	_ TaskBuilder = &DoTaskBuilder{}
	_ TaskBuilder = &ForTaskBuilder{}
	_ TaskBuilder = &ForkTaskBuilder{}
	_ TaskBuilder = &ListenTaskBuilder{}
	_ TaskBuilder = &RaiseTaskBuilder{}
	_ TaskBuilder = &RunTaskBuilder{}
	_ TaskBuilder = &SetTaskBuilder{}
	_ TaskBuilder = &SwitchTaskBuilder{}
	_ TaskBuilder = &TryTaskBuilder{}
	_ TaskBuilder = &WaitTaskBuilder{}
)
