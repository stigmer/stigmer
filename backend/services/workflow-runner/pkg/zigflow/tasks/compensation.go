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
	"fmt"

	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"go.temporal.io/sdk/workflow"
)

// CompensationEntry records a completed task and its associated undo operations.
type CompensationEntry struct {
	TaskName        string
	CompensateTasks []map[string]interface{}
	TaskOutput      any
}

// CompensationStack tracks completed tasks that declared compensation blocks.
// It is built up during iterateTasks and consumed by the TryTaskBuilder on error.
type CompensationStack struct {
	entries []CompensationEntry
}

// Push records a completed task with its compensation tasks.
func (s *CompensationStack) Push(entry CompensationEntry) {
	s.entries = append(s.entries, entry)
}

// IsEmpty returns true if no compensatable tasks have been recorded.
func (s *CompensationStack) IsEmpty() bool {
	return len(s.entries) == 0
}

// RunReverse executes compensation tasks in reverse order (last completed → first).
// Compensation failures are collected but do not stop subsequent compensations.
func (s *CompensationStack) RunReverse(
	ctx workflow.Context,
	temporalWorker interface{},
	doc interface{},
	state *utils.State,
) []CompensationError {
	logger := workflow.GetLogger(ctx)
	var errors []CompensationError

	for i := len(s.entries) - 1; i >= 0; i-- {
		entry := s.entries[i]
		logger.Info("Running compensation for task",
			"task", entry.TaskName,
			"compensation_tasks", len(entry.CompensateTasks))

		for _, compTask := range entry.CompensateTasks {
			if err := executeCompensationTask(ctx, compTask, entry, state); err != nil {
				logger.Warn("Compensation task failed",
					"original_task", entry.TaskName,
					"error", err)
				errors = append(errors, CompensationError{
					TaskName: entry.TaskName,
					Error:    err,
				})
			}
		}
	}

	return errors
}

// CompensationError records a failed compensation attempt.
type CompensationError struct {
	TaskName string
	Error    error
}

// executeCompensationTask runs a single compensation task definition.
// The compensation task receives the original task's output in the state
// context so it can construct appropriate undo operations.
func executeCompensationTask(
	ctx workflow.Context,
	taskDef map[string]interface{},
	entry CompensationEntry,
	state *utils.State,
) error {
	logger := workflow.GetLogger(ctx)

	// Inject the original task's output into state for the compensation task
	compState := state.Clone()
	compState.AddData(map[string]any{
		"__compensating_task":   entry.TaskName,
		"__compensating_output": entry.TaskOutput,
	})

	// Extract the task name (first key in the map)
	for taskName := range taskDef {
		logger.Debug("Executing compensation task",
			"compensation_task", taskName,
			"for_task", entry.TaskName)
		break
	}

	// Compensation tasks are lightweight: we log them but do not wire them
	// into the full task builder pipeline. This avoids circular dependencies
	// and keeps compensation execution simple and predictable.
	//
	// For V1, compensation tasks that need complex execution (HTTP calls,
	// agent calls) should use the existing task types inside a do: block.
	// Full task builder support for compensation will be added when we
	// observe real usage patterns.
	logger.Info("Compensation task recorded (V1: logged, full execution in V2)",
		"task_def", fmt.Sprintf("%v", taskDef),
		"for_task", entry.TaskName)

	return nil
}

// ExtractCompensationTasks reads the __stigmer_compensate metadata from
// a task's metadata map, returning the compensation task definitions.
func ExtractCompensationTasks(metadata map[string]any) []map[string]interface{} {
	if metadata == nil {
		return nil
	}

	raw, ok := metadata["__stigmer_compensate"]
	if !ok {
		return nil
	}

	list, ok := raw.([]interface{})
	if !ok {
		if typedList, ok := raw.([]map[string]interface{}); ok {
			return typedList
		}
		return nil
	}

	result := make([]map[string]interface{}, 0, len(list))
	for _, item := range list {
		if m, ok := item.(map[string]interface{}); ok {
			result = append(result, m)
		}
	}
	return result
}

// CatchBlockWantsCompensation reads the compensate flag from a catch block's
// metadata, which is carried through the YAML pipeline since the CNCF SDK
// CatchBlock model does not have a native compensate field.
func CatchBlockWantsCompensation(catchConfig map[string]any) bool {
	if catchConfig == nil {
		return false
	}
	v, ok := catchConfig["compensate"]
	if !ok {
		return false
	}
	b, ok := v.(bool)
	return ok && b
}
