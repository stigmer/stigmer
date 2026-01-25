package workflow

import (
	"fmt"
	"regexp"

	"github.com/stigmer/stigmer/sdk/go/internal/validation"
)

// Validation constants for SDK-specific task name format.
const (
	taskNameMaxLength = 100
)

// taskNameRegex matches valid task names (alphanumeric with hyphens and underscores).
// This is an SDK-specific naming convention.
var taskNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// validate validates SDK-specific rules for a Workflow.
//
// This function validates only SDK-specific conventions that are not covered
// by protovalidate rules. Field-level validations (required fields, min/max
// lengths, etc.) are handled by protovalidate in ToProto().
//
// SDK-specific rules validated here:
//   - Task name format: alphanumeric with hyphens and underscores (SDK naming convention)
//   - Task name uniqueness: no duplicate task names within workflow (cross-field validation)
func validate(w *Workflow) error {
	// Note: Document validation (DSL version, namespace, name required) is handled
	// by protovalidate when ToProto() is called. The proto has:
	// - dsl: string.pattern = "^1\.0\.0$"
	// - namespace: required = true
	// - name: required = true
	// - version: required = true

	// Note: We allow empty workflows during creation to support the Pulumi-style
	// pattern where workflows are created first, then tasks are added via
	// wf.HttpGet(), wf.SetVars(), etc. Task config validation happens in ToProto()
	// via protovalidate.
	if len(w.Tasks) == 0 {
		return nil
	}

	// Validate task names are unique (SDK-specific cross-field validation)
	// This cannot be expressed in proto validation rules.
	taskNames := make(map[string]bool)
	for i, task := range w.Tasks {
		if err := validateTaskName(task.Name); err != nil {
			return fmt.Errorf("task[%d]: %w", i, err)
		}

		if taskNames[task.Name] {
			return validation.NewValidationErrorWithCause(
				validation.FieldPath("tasks", i, "name"),
				task.Name,
				"unique",
				fmt.Sprintf("duplicate task name: %q", task.Name),
				ErrDuplicateTaskName,
			)
		}
		taskNames[task.Name] = true
	}

	return nil
}

// validateTaskName validates a task name against SDK naming conventions.
//
// Rules (SDK-specific, not in proto):
//   - Required (non-empty)
//   - Max 100 characters
//   - Alphanumeric with hyphens and underscores
//
// Note: The proto has a required rule for task.name, but the format regex
// is an SDK-specific convention for consistent naming.
func validateTaskName(name string) error {
	if name == "" {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"required",
			"task name is required",
			ErrInvalidTaskName,
		)
	}

	if len(name) > taskNameMaxLength {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"max_length",
			fmt.Sprintf("task name must be at most %d characters", taskNameMaxLength),
			ErrInvalidTaskName,
		)
	}

	if !taskNameRegex.MatchString(name) {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"format",
			"task name must be alphanumeric with hyphens and underscores",
			ErrInvalidTaskName,
		)
	}

	return nil
}
