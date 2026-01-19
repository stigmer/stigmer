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

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"buf.build/go/protovalidate"
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
// Returns error on first validation failure, or nil if all tasks are valid.
func ValidateWorkflow(spec *workflowv1.WorkflowSpec) error {
	if spec == nil {
		return fmt.Errorf("workflow spec cannot be nil")
	}

	if len(spec.Tasks) == 0 {
		return fmt.Errorf("workflow must have at least one task")
	}

	// Validate each task
	for i, task := range spec.Tasks {
		if err := ValidateTask(task); err != nil {
			return fmt.Errorf("task %d validation failed: %w", i+1, err)
		}
	}

	return nil
}
