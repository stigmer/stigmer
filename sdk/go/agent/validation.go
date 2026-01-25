package agent

import (
	"fmt"
	"regexp"
)

// Validation constants for SDK-specific name format.
const (
	nameMaxLength = 63
)

// nameRegex matches valid agent names (lowercase alphanumeric with hyphens).
// This is an SDK-specific naming convention not enforced by proto validation.
var nameRegex = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

// validate validates SDK-specific rules for an Agent.
//
// This function validates only SDK-specific conventions that are not covered
// by protovalidate rules. Field-level validations (required fields, min/max
// lengths, etc.) are handled by protovalidate in ToProto().
//
// SDK-specific rules validated here:
//   - Name format: lowercase alphanumeric with hyphens (SDK naming convention)
func validate(a *Agent) error {
	return validateName(a.Name)
}

// validateName validates the agent name against SDK naming conventions.
//
// Rules (SDK-specific, not in proto):
//   - Required (non-empty)
//   - Lowercase alphanumeric with hyphens
//   - Must start and end with alphanumeric
//   - Max 63 characters (DNS-compatible)
//
// Note: Basic required checks are also in proto, but the lowercase format
// regex is an SDK-specific convention for consistent naming.
func validateName(name string) error {
	if name == "" {
		return &ValidationError{
			Field:   "name",
			Value:   name,
			Rule:    "required",
			Message: "name is required",
			Err:     ErrInvalidName,
		}
	}

	if len(name) > nameMaxLength {
		return &ValidationError{
			Field:   "name",
			Value:   truncateValue(name),
			Rule:    "max_length",
			Message: fmt.Sprintf("name must be at most %d characters (got %d)", nameMaxLength, len(name)),
			Err:     ErrInvalidName,
		}
	}

	if !nameRegex.MatchString(name) {
		return &ValidationError{
			Field:   "name",
			Value:   truncateValue(name),
			Rule:    "format",
			Message: "invalid name format: must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric",
			Err:     ErrInvalidName,
		}
	}

	return nil
}

// truncateValue truncates a value for display in error messages.
func truncateValue(v string) string {
	const maxLen = 50
	if len(v) <= maxLen {
		return v
	}
	return v[:maxLen] + "..."
}
