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

	"buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go/buf/validate"
)

// ValidationError represents a single validation failure.
type ValidationError struct {
	TaskName  string
	TaskKind  string
	FieldPath string
	Message   string
}

// Error implements the error interface.
func (e *ValidationError) Error() string {
	return fmt.Sprintf(
		"validation failed for task '%s' (%s): field '%s' %s",
		e.TaskName, e.TaskKind, e.FieldPath, e.Message,
	)
}

// ValidationErrors represents multiple validation failures.
type ValidationErrors struct {
	Errors []ValidationError
}

// Error implements the error interface.
func (e *ValidationErrors) Error() string {
	if len(e.Errors) == 0 {
		return "validation failed"
	}

	if len(e.Errors) == 1 {
		return e.Errors[0].Error()
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("validation failed with %d errors:\n", len(e.Errors)))
	for i, err := range e.Errors {
		sb.WriteString(fmt.Sprintf("  %d. %s\n", i+1, err.Error()))
	}
	return sb.String()
}

// FormatValidationErrors converts protovalidate violations to ValidationError.
// This function is currently not used but kept for potential future use.
func FormatValidationErrors(taskName string, taskKind string, violations []*validate.Violation) []ValidationError {
	errors := make([]ValidationError, 0, len(violations))
	for _, v := range violations {
		// Note: This function is unused and would need updating to use
		// protovalidate.FieldPathString(v.GetField()) instead of GetFieldPath()
		errors = append(errors, ValidationError{
			TaskName:  taskName,
			TaskKind:  taskKind,
			FieldPath: "", // Would need FieldPath conversion
			Message:   v.GetMessage(),
		})
	}
	return errors
}
