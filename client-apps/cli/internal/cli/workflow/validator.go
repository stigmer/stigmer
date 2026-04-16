// Package workflow provides CLI utilities for managing Workflow resources.
package workflow

import (
	"fmt"
	"sort"
	"strings"

	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
)

// Validate performs cross-field business logic validation on a Workflow.
//
// Schema validation (apiVersion, kind, metadata, document, tasks) is handled
// by protovalidate in Load(). This function validates relationships between
// fields that cannot be expressed in proto validation rules:
//
//   - Task names must be unique within the workflow
//   - flow.then must reference an existing task name or "end"
//   - No circular dependencies in flow control (DAG validation)
//
// Returns nil if the workflow passes all cross-field validations.
func Validate(workflow *workflowv1.Workflow) error {
	if workflow == nil || workflow.Spec == nil {
		return nil // Schema validation handles required fields
	}

	// Build task name set for reference validation
	taskNames := collectTaskNames(workflow.Spec.Tasks)

	if err := validateUniqueTaskNames(workflow.Spec.Tasks); err != nil {
		return err
	}

	if err := validateFlowControlReferences(workflow.Spec.Tasks, taskNames); err != nil {
		return err
	}

	if err := validateNoCycles(workflow.Spec.Tasks, taskNames); err != nil {
		return err
	}

	return nil
}

// collectTaskNames builds a set of all task names in the workflow.
// Returns a map of task name -> index for O(1) lookup.
func collectTaskNames(tasks []*workflowv1.WorkflowTask) map[string]int {
	names := make(map[string]int, len(tasks))
	for i, task := range tasks {
		if task == nil || task.Name == "" {
			continue // Proto validation handles required fields
		}
		names[task.Name] = i
	}
	return names
}

// validateUniqueTaskNames ensures no duplicate task names exist in the workflow.
func validateUniqueTaskNames(tasks []*workflowv1.WorkflowTask) error {
	seen := make(map[string]int, len(tasks))

	for i, task := range tasks {
		if task == nil || task.Name == "" {
			continue
		}

		if firstIdx, exists := seen[task.Name]; exists {
			return fmt.Errorf(
				"duplicate task name %q at tasks[%d]: already defined at tasks[%d]\n\n"+
					"Each task name must be unique within the workflow. "+
					"Rename one of the tasks to resolve the conflict.",
				task.Name, i, firstIdx,
			)
		}
		seen[task.Name] = i
	}

	return nil
}

// validateFlowControlReferences ensures all flow.then values reference valid targets.
// Valid targets are: existing task names or the literal "end".
func validateFlowControlReferences(tasks []*workflowv1.WorkflowTask, taskNames map[string]int) error {
	for i, task := range tasks {
		if task == nil || task.Flow == nil {
			continue
		}

		then := task.Flow.Then
		if then == "" {
			continue // Empty means "continue to next task" (default behavior)
		}

		// "end" is a special value that terminates the workflow
		if then == "end" {
			continue
		}

		if _, exists := taskNames[then]; !exists {
			available := formatAvailableTaskNames(taskNames)
			return fmt.Errorf(
				"invalid flow reference at tasks[%d].flow.then: task %q does not exist\n\n"+
					"The 'then' field must reference an existing task name or \"end\".\n"+
					"Available task names: %s",
				i, then, available,
			)
		}
	}

	return nil
}

// validateNoCycles detects circular dependencies in the flow control graph.
// Uses DFS with path tracking to find cycles.
func validateNoCycles(tasks []*workflowv1.WorkflowTask, taskNames map[string]int) error {
	graph := buildFlowGraph(tasks)
	visited := make(map[string]bool, len(taskNames))
	path := make(map[string]bool, len(taskNames))
	pathOrder := make([]string, 0, len(taskNames))

	var dfs func(node string) error
	dfs = func(node string) error {
		if path[node] {
			cycle := reconstructCyclePath(pathOrder, node)
			return fmt.Errorf(
				"circular dependency detected in workflow flow control\n\n"+
					"Cycle: %s\n\n"+
					"Break the cycle by changing one of the flow.then references "+
					"or using \"end\" to terminate a branch.",
				cycle,
			)
		}

		if visited[node] {
			return nil
		}

		visited[node] = true
		path[node] = true
		pathOrder = append(pathOrder, node)

		if next, hasEdge := graph[node]; hasEdge && next != "end" {
			if _, isValidTask := taskNames[next]; isValidTask {
				if err := dfs(next); err != nil {
					return err
				}
			}
		}

		path[node] = false
		pathOrder = pathOrder[:len(pathOrder)-1]
		return nil
	}

	for taskName := range taskNames {
		if !visited[taskName] {
			if err := dfs(taskName); err != nil {
				return err
			}
		}
	}

	return nil
}

// buildFlowGraph creates an adjacency map from flow.then references.
func buildFlowGraph(tasks []*workflowv1.WorkflowTask) map[string]string {
	graph := make(map[string]string, len(tasks))
	for _, task := range tasks {
		if task == nil || task.Flow == nil || task.Flow.Then == "" {
			continue
		}
		graph[task.Name] = task.Flow.Then
	}
	return graph
}

// reconstructCyclePath builds a human-readable cycle path string.
func reconstructCyclePath(pathOrder []string, cycleStart string) string {
	startIdx := -1
	for i, node := range pathOrder {
		if node == cycleStart {
			startIdx = i
			break
		}
	}

	if startIdx == -1 {
		return cycleStart + " -> " + cycleStart
	}

	cycleParts := append(pathOrder[startIdx:], cycleStart)
	return strings.Join(cycleParts, " -> ")
}

// formatAvailableTaskNames formats task names for error messages.
func formatAvailableTaskNames(taskNames map[string]int) string {
	if len(taskNames) == 0 {
		return "(none)"
	}

	names := make([]string, 0, len(taskNames))
	for name := range taskNames {
		names = append(names, name)
	}
	sort.Strings(names)

	return strings.Join(names, ", ")
}
