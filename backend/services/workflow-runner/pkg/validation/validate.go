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

package validation

import (
	"fmt"
	"strings"

	"buf.build/go/protovalidate"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"google.golang.org/protobuf/proto"
)

// validator is the global protovalidate validator instance.
var validator protovalidate.Validator

func init() {
	// Initialize validator once at package load time
	var err error
	validator, err = protovalidate.New()
	if err != nil {
		panic(fmt.Sprintf("failed to initialize protovalidate: %v", err))
	}
}

// ValidateTaskConfig validates a proto message using buf validate rules.
//
// Uses protovalidate library to enforce validation constraints defined
// in proto files (buf.validate.field annotations).
//
// Returns nil if validation passes, or ValidationErrors with detailed
// information about what failed.
func ValidateTaskConfig(msg proto.Message) error {
	if msg == nil {
		return fmt.Errorf("message cannot be nil")
	}

	// Run validation
	err := validator.Validate(msg)
	if err == nil {
		// Validation passed
		return nil
	}

	// Check if it's a validation error
	if valErr, ok := err.(*protovalidate.ValidationError); ok {
		// Format violations into user-friendly errors
		violations := valErr.Violations
		if len(violations) == 0 {
			return fmt.Errorf("validation failed: %w", err)
		}

		// Create ValidationErrors with formatted messages
		errors := make([]ValidationError, 0, len(violations))
		for _, v := range violations {
			// Access the underlying proto violation for field path and message
			protoViolation := v.Proto
			// Convert FieldPath to string using protovalidate helper
			fieldPath := protovalidate.FieldPathString(protoViolation.GetField())
			errors = append(errors, ValidationError{
				TaskName:  "", // Will be set by ValidateTask
				TaskKind:  "", // Will be set by ValidateTask
				FieldPath: fieldPath,
				Message:   protoViolation.GetMessage(),
			})
		}

		return &ValidationErrors{Errors: errors}
	}

	// Unknown error
	return fmt.Errorf("validation failed: %w", err)
}

// ValidateTask unmarshals and validates a WorkflowTask in one call.
//
// This is a convenience function that combines UnmarshalTaskConfig and
// ValidateTaskConfig, and adds task name/kind context to error messages.
//
// Usage:
//
//	err := ValidateTask(task)
//	if err != nil {
//	    // Task is invalid
//	    return err
//	}
func ValidateTask(task *workflowv1.WorkflowTask) error {
	if task == nil {
		return fmt.Errorf("task cannot be nil")
	}

	// 1. Unmarshal Struct → Typed Proto (this also validates)
	msg, err := UnmarshalTaskConfig(task.Kind, task.TaskConfig)
	if err != nil {
		// Add task context to validation errors if applicable
		taskKind := task.Kind.String()
		if valErrs, ok := err.(*ValidationErrors); ok {
			// Add task name and kind to each error
			for i := range valErrs.Errors {
				valErrs.Errors[i].TaskName = task.Name
				valErrs.Errors[i].TaskKind = taskKind
			}
			return err
		}
		// For non-validation errors, wrap with task context
		return fmt.Errorf("failed to unmarshal task '%s' (%s): %w", task.Name, taskKind, err)
	}

	// 2. Validate Proto (redundant now, but kept for backwards compatibility)
	err = ValidateTaskConfig(msg)
	if err != nil {
		// Add task context to validation errors
		if valErrs, ok := err.(*ValidationErrors); ok {
			// Add task name and kind to each error
			taskKind := task.Kind.String()
			for i := range valErrs.Errors {
				valErrs.Errors[i].TaskName = task.Name
				valErrs.Errors[i].TaskKind = taskKind
			}
		}
		return err
	}

	return nil
}

// ValidateWorkflow validates all tasks in a workflow.
//
// Validation layers (in order):
//  1. Per-task structural validation (unmarshal + buf.validate constraints)
//  2. Cross-task reference validation (fallback_task, then, outcome.then)
//
// Returns error on first validation failure, or nil if all tasks are valid.
func ValidateWorkflow(spec *workflowv1.WorkflowSpec) error {
	if spec == nil {
		return fmt.Errorf("workflow spec cannot be nil")
	}

	if len(spec.Tasks) == 0 {
		return fmt.Errorf("workflow must have at least one task")
	}

	// Layer 1: Validate each task's structure and field constraints.
	for i, task := range spec.Tasks {
		if err := ValidateTask(task); err != nil {
			return fmt.Errorf("task %d validation failed: %w", i+1, err)
		}
	}

	// Layer 2: Validate cross-task references (fallback_task, then, outcome.then).
	if err := ValidateCrossTaskReferences(spec); err != nil {
		return err
	}

	return nil
}

// CheckStructuredOutputWarnings performs semantic analysis on a workflow to detect
// switch_case tasks that route on agent_call output without a structured output schema.
//
// Routing on unstructured agent text is fragile -- expressions like
// "${ $context.triage.severity == 'critical' }" will fail or produce unexpected
// results when the referenced task output is raw prose. This check nudges workflow
// authors toward declaring output schemas on their agent_call tasks.
//
// Returns a list of human-readable warning strings suitable for inclusion in
// ServerlessWorkflowValidation.warnings.
func CheckStructuredOutputWarnings(spec *workflowv1.WorkflowSpec) []string {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}

	// Build lookup: task name → whether it's an agent_call without output schema.
	agentCallsWithoutSchema := make(map[string]bool)
	for _, task := range spec.Tasks {
		if task.Kind != workflowv1.WorkflowTaskKind_agent_call {
			continue
		}
		msg, err := UnmarshalTaskConfig(task.Kind, task.TaskConfig)
		if err != nil {
			continue
		}
		agentConfig, ok := msg.(*tasksv1.AgentCallTaskConfig)
		if !ok {
			continue
		}
		agentCallsWithoutSchema[task.Name] = agentConfig.Output == nil
	}

	if len(agentCallsWithoutSchema) == 0 {
		return nil
	}

	// Inspect each switch_case task's when expressions for $context references
	// to agent_call tasks that lack output schemas.
	var warnings []string
	for _, task := range spec.Tasks {
		if task.Kind != workflowv1.WorkflowTaskKind_switch_case {
			continue
		}
		msg, err := UnmarshalTaskConfig(task.Kind, task.TaskConfig)
		if err != nil {
			continue
		}
		switchConfig, ok := msg.(*tasksv1.SwitchTaskConfig)
		if !ok {
			continue
		}
		for _, sc := range switchConfig.Cases {
			if sc.When == "" {
				continue
			}
			for agentTaskName, hasNoSchema := range agentCallsWithoutSchema {
				if !hasNoSchema {
					continue
				}
				if referencesContext(sc.When, agentTaskName) {
					warnings = append(warnings, fmt.Sprintf(
						"Task '%s' routes on output from agent_call '%s' which has no structured output schema. "+
							"Routing on unstructured text is fragile. Consider adding an output schema to the agent_call task.",
						task.Name, agentTaskName,
					))
				}
			}
		}
	}

	return warnings
}

// CheckBudgetWarnings performs semantic analysis on a workflow to detect
// budget-related misconfigurations that are not proto-level errors but likely
// indicate authoring mistakes.
//
// Returns a list of human-readable warning strings suitable for inclusion in
// ServerlessWorkflowValidation.warnings.
func CheckBudgetWarnings(spec *workflowv1.WorkflowSpec) []string {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}

	var warnings []string

	hasCostIncurringTasks := false
	var perTaskCostSum int64
	var perTaskEntries []struct {
		name string
		cost int64
	}

	for _, task := range spec.Tasks {
		switch task.Kind {
		case workflowv1.WorkflowTaskKind_llm_call:
			hasCostIncurringTasks = true
			msg, err := UnmarshalTaskConfig(task.Kind, task.TaskConfig)
			if err != nil {
				continue
			}
			if cfg, ok := msg.(*tasksv1.LlmCallTaskConfig); ok && cfg.MaxCostMicros > 0 {
				perTaskCostSum += cfg.MaxCostMicros
				perTaskEntries = append(perTaskEntries, struct {
					name string
					cost int64
				}{task.Name, cfg.MaxCostMicros})
			}

		case workflowv1.WorkflowTaskKind_agent_call:
			hasCostIncurringTasks = true
			msg, err := UnmarshalTaskConfig(task.Kind, task.TaskConfig)
			if err != nil {
				continue
			}
			if cfg, ok := msg.(*tasksv1.AgentCallTaskConfig); ok && cfg.Config != nil && cfg.Config.MaxCostMicros > 0 {
				perTaskCostSum += cfg.Config.MaxCostMicros
				perTaskEntries = append(perTaskEntries, struct {
					name string
					cost int64
				}{task.Name, cfg.Config.MaxCostMicros})
			}
		}
	}

	// Warn when cost-incurring tasks exist but no workflow budget is set.
	if hasCostIncurringTasks && spec.Budget == nil {
		warnings = append(warnings,
			"Workflow contains cost-incurring tasks (agent_call, llm_call) but no budget limit is set. "+
				"Consider adding a budget to prevent unexpected costs.")
	}

	if spec.Budget != nil && spec.Budget.MaxCostMicros > 0 {
		// Warn when any per-task cost cap exceeds the workflow budget.
		for _, entry := range perTaskEntries {
			if entry.cost > spec.Budget.MaxCostMicros {
				warnings = append(warnings, fmt.Sprintf(
					"Task '%s' has max_cost_micros (%d) that exceeds the workflow budget max_cost_micros (%d).",
					entry.name, entry.cost, spec.Budget.MaxCostMicros))
			}
		}

		// Warn when the sum of per-task cost caps exceeds the workflow budget.
		if perTaskCostSum > spec.Budget.MaxCostMicros && len(perTaskEntries) > 1 {
			warnings = append(warnings, fmt.Sprintf(
				"Combined per-task cost limits ($%.2f) exceed the workflow budget ($%.2f). "+
					"Some tasks may be terminated before reaching their individual limits.",
				float64(perTaskCostSum)/1_000_000,
				float64(spec.Budget.MaxCostMicros)/1_000_000))
		}
	}

	return warnings
}

// referencesContext checks whether an expression references a task's output
// via the $context variable. It looks for patterns like "$context.taskName"
// which is how switch_case when-expressions access prior task outputs.
func referencesContext(expr string, taskName string) bool {
	// Match common patterns:
	//   $context.taskName
	//   $context.taskName.field
	//   $context["taskName"]
	patterns := []string{
		"$context." + taskName,
		`$context["` + taskName + `"]`,
		`$context['` + taskName + `']`,
	}
	for _, p := range patterns {
		if strings.Contains(expr, p) {
			return true
		}
	}
	return false
}
