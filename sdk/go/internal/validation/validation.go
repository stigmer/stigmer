package validation

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// FieldPath builds a hierarchical field path string for nested validation.
//
// It accepts a mix of strings (field names) and integers (array indices),
// and produces a dot-separated path with bracket notation for indices.
//
// Examples:
//
//	FieldPath("name")                        // "name"
//	FieldPath("config", "timeout")           // "config.timeout"
//	FieldPath("volumes", 2, "host_path")     // "volumes[2].host_path"
//	FieldPath("tasks", 0, "config", "method") // "tasks[0].config.method"
func FieldPath(parts ...interface{}) string {
	if len(parts) == 0 {
		return ""
	}

	var sb strings.Builder
	for i, part := range parts {
		switch v := part.(type) {
		case string:
			if i > 0 && sb.Len() > 0 {
				// Don't add dot if previous was an index
				lastChar := sb.String()[sb.Len()-1]
				if lastChar != ']' {
					sb.WriteByte('.')
				} else {
					sb.WriteByte('.')
				}
			}
			sb.WriteString(v)
		case int:
			sb.WriteByte('[')
			sb.WriteString(strconv.Itoa(v))
			sb.WriteByte(']')
		default:
			// Fallback: convert to string
			if i > 0 && sb.Len() > 0 {
				sb.WriteByte('.')
			}
			sb.WriteString(fmt.Sprintf("%v", v))
		}
	}
	return sb.String()
}

// RequiredWithMessage validates that a string field is non-empty with a custom message.
//
// Returns nil if value is non-empty, or a ValidationError with the custom message if empty.
//
// Note: Most required field validation should be handled by protovalidate.
// This helper is only for SDK-specific validations not covered by proto rules.
func RequiredWithMessage(field, value, message string) error {
	if value == "" {
		return &ValidationError{
			Field:   field,
			Value:   value,
			Rule:    "required",
			Message: message,
			Err:     ErrRequired,
		}
	}
	return nil
}

// MatchesPattern validates that a string matches a regex pattern.
//
// Parameters:
//   - field: the field name for error messages
//   - value: the string to validate
//   - pattern: a compiled regex pattern
//   - description: human-readable description of the expected format
//
// Note: This helper is for SDK-specific format validations (like naming conventions)
// that are not defined in proto files.
//
// Example:
//
//	nameRegex := regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)
//	if err := validation.MatchesPattern("name", name, nameRegex,
//	    "lowercase alphanumeric with hyphens, starting and ending with alphanumeric"); err != nil {
//	    return err
//	}
func MatchesPattern(field, value string, pattern *regexp.Regexp, description string) error {
	if !pattern.MatchString(value) {
		return &ValidationError{
			Field:   field,
			Value:   truncateValue(value), // truncateValue is defined in errors.go
			Rule:    "format",
			Message: fmt.Sprintf("invalid %s format: must be %s", field, description),
			Err:     ErrInvalidFormat,
		}
	}
	return nil
}
