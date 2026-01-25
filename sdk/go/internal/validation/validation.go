package validation

import (
	"fmt"
	"net/url"
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

// Required validates that a string field is non-empty.
//
// Returns nil if value is non-empty, or a ValidationError if empty.
//
// Example:
//
//	if err := validation.Required("name", agent.Name); err != nil {
//	    return err
//	}
func Required(field, value string) error {
	if value == "" {
		return &ValidationError{
			Field:   field,
			Value:   value,
			Rule:    "required",
			Message: field + " is required",
			Err:     ErrRequired,
		}
	}
	return nil
}

// RequiredWithMessage validates that a string field is non-empty with a custom message.
//
// Returns nil if value is non-empty, or a ValidationError with the custom message if empty.
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

// MinLength validates that a string has at least min characters.
//
// Returns nil if len(value) >= min, or a ValidationError otherwise.
//
// Example:
//
//	if err := validation.MinLength("instructions", instructions, 10); err != nil {
//	    return err
//	}
func MinLength(field, value string, min int) error {
	if len(value) < min {
		return &ValidationError{
			Field:   field,
			Value:   truncateValue(value),
			Rule:    "min_length",
			Message: fmt.Sprintf("%s must be at least %d characters (got %d)", field, min, len(value)),
			Err:     ErrMinLength,
		}
	}
	return nil
}

// MinLengthTrimmed validates that a trimmed string has at least min characters.
//
// This is useful for fields where leading/trailing whitespace shouldn't count.
//
// Example:
//
//	if err := validation.MinLengthTrimmed("instructions", instructions, 10); err != nil {
//	    return err
//	}
func MinLengthTrimmed(field, value string, min int) error {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) < min {
		return &ValidationError{
			Field:   field,
			Value:   truncateValue(value),
			Rule:    "min_length",
			Message: fmt.Sprintf("%s must be at least %d characters (got %d)", field, min, len(trimmed)),
			Err:     ErrMinLength,
		}
	}
	return nil
}

// MaxLength validates that a string has at most max characters.
//
// Returns nil if len(value) <= max, or a ValidationError otherwise.
//
// Example:
//
//	if err := validation.MaxLength("description", description, 500); err != nil {
//	    return err
//	}
func MaxLength(field, value string, max int) error {
	if len(value) > max {
		return &ValidationError{
			Field:   field,
			Value:   truncateValue(value),
			Rule:    "max_length",
			Message: fmt.Sprintf("%s must be at most %d characters (got %d)", field, max, len(value)),
			Err:     ErrMaxLength,
		}
	}
	return nil
}

// MaxLengthTrimmed validates that a trimmed string has at most max characters.
//
// This is useful for fields where leading/trailing whitespace shouldn't count.
func MaxLengthTrimmed(field, value string, max int) error {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) > max {
		return &ValidationError{
			Field:   field,
			Value:   truncateValue(value),
			Rule:    "max_length",
			Message: fmt.Sprintf("%s must be at most %d characters (got %d)", field, max, len(trimmed)),
			Err:     ErrMaxLength,
		}
	}
	return nil
}

// LengthRange validates that a string length is within [min, max].
//
// Returns nil if min <= len(value) <= max, or a ValidationError otherwise.
//
// Example:
//
//	if err := validation.LengthRange("task_name", name, 1, 100); err != nil {
//	    return err
//	}
func LengthRange(field, value string, min, max int) error {
	length := len(value)
	if length < min || length > max {
		return &ValidationError{
			Field:   field,
			Value:   truncateValue(value),
			Rule:    "length",
			Message: fmt.Sprintf("%s must be between %d and %d characters (got %d)", field, min, max, length),
			Err:     ErrMaxLength, // Use max_length as the base error
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
			Value:   truncateValue(value),
			Rule:    "format",
			Message: fmt.Sprintf("invalid %s format: must be %s", field, description),
			Err:     ErrInvalidFormat,
		}
	}
	return nil
}

// ValidHTTPURL validates that a string is a valid HTTP or HTTPS URL.
//
// It checks:
//   - The URL can be parsed
//   - The scheme is "http" or "https"
//   - A host is present
//
// Example:
//
//	if err := validation.ValidHTTPURL("icon_url", iconURL); err != nil {
//	    return err
//	}
func ValidHTTPURL(field, value string) error {
	if value == "" {
		// Empty is handled by Required() - don't duplicate that check
		return nil
	}

	parsedURL, err := url.Parse(value)
	if err != nil {
		return &ValidationError{
			Field:   field,
			Value:   truncateValue(value),
			Rule:    "url_format",
			Message: fmt.Sprintf("%s must be a valid URL", field),
			Err:     ErrInvalidURL,
		}
	}

	// Must have http or https scheme
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return &ValidationError{
			Field:   field,
			Value:   truncateValue(value),
			Rule:    "url_scheme",
			Message: fmt.Sprintf("%s must use http or https scheme", field),
			Err:     ErrInvalidURL,
		}
	}

	// Must have a host
	if parsedURL.Host == "" {
		return &ValidationError{
			Field:   field,
			Value:   truncateValue(value),
			Rule:    "url_host",
			Message: fmt.Sprintf("%s must have a valid host", field),
			Err:     ErrInvalidURL,
		}
	}

	return nil
}

// OneOf validates that a string value is one of the allowed values.
//
// Example:
//
//	if err := validation.OneOf("method", method, []string{"GET", "POST", "PUT", "DELETE", "PATCH"}); err != nil {
//	    return err
//	}
func OneOf(field, value string, allowed []string) error {
	for _, a := range allowed {
		if value == a {
			return nil
		}
	}
	return &ValidationError{
		Field:   field,
		Value:   value,
		Rule:    "enum",
		Message: fmt.Sprintf("%s must be one of: %s", field, strings.Join(allowed, ", ")),
		Err:     ErrInvalidEnum,
	}
}

// OneOfWithMessage validates that a string value is one of the allowed values with a custom message.
func OneOfWithMessage(field, value string, allowed []string, message string) error {
	for _, a := range allowed {
		if value == a {
			return nil
		}
	}
	return &ValidationError{
		Field:   field,
		Value:   value,
		Rule:    "enum",
		Message: message,
		Err:     ErrInvalidEnum,
	}
}

// MinInt validates that an integer is at least min.
//
// Example:
//
//	if err := validation.MinInt("port", port, 1); err != nil {
//	    return err
//	}
func MinInt(field string, value, min int) error {
	if value < min {
		return &ValidationError{
			Field:   field,
			Value:   strconv.Itoa(value),
			Rule:    "min",
			Message: fmt.Sprintf("%s must be at least %d (got %d)", field, min, value),
			Err:     ErrOutOfRange,
		}
	}
	return nil
}

// MinInt32 validates that an int32 is at least min.
func MinInt32(field string, value, min int32) error {
	if value < min {
		return &ValidationError{
			Field:   field,
			Value:   strconv.FormatInt(int64(value), 10),
			Rule:    "min",
			Message: fmt.Sprintf("%s must be at least %d (got %d)", field, min, value),
			Err:     ErrOutOfRange,
		}
	}
	return nil
}

// MaxInt validates that an integer is at most max.
//
// Example:
//
//	if err := validation.MaxInt("timeout", timeout, 300); err != nil {
//	    return err
//	}
func MaxInt(field string, value, max int) error {
	if value > max {
		return &ValidationError{
			Field:   field,
			Value:   strconv.Itoa(value),
			Rule:    "max",
			Message: fmt.Sprintf("%s must be at most %d (got %d)", field, max, value),
			Err:     ErrOutOfRange,
		}
	}
	return nil
}

// MaxInt32 validates that an int32 is at most max.
func MaxInt32(field string, value, max int32) error {
	if value > max {
		return &ValidationError{
			Field:   field,
			Value:   strconv.FormatInt(int64(value), 10),
			Rule:    "max",
			Message: fmt.Sprintf("%s must be at most %d (got %d)", field, max, value),
			Err:     ErrOutOfRange,
		}
	}
	return nil
}

// RangeInt validates that an integer is within [min, max].
//
// Example:
//
//	if err := validation.RangeInt("timeout_seconds", timeout, 0, 300); err != nil {
//	    return err
//	}
func RangeInt(field string, value, min, max int) error {
	if value < min || value > max {
		return &ValidationError{
			Field:   field,
			Value:   strconv.Itoa(value),
			Rule:    "range",
			Message: fmt.Sprintf("%s must be between %d and %d (got %d)", field, min, max, value),
			Err:     ErrOutOfRange,
		}
	}
	return nil
}

// RangeInt32 validates that an int32 is within [min, max].
func RangeInt32(field string, value, min, max int32) error {
	if value < min || value > max {
		return &ValidationError{
			Field:   field,
			Value:   strconv.FormatInt(int64(value), 10),
			Rule:    "range",
			Message: fmt.Sprintf("%s must be between %d and %d (got %d)", field, min, max, value),
			Err:     ErrOutOfRange,
		}
	}
	return nil
}

// NonNegativeInt32 validates that an int32 is >= 0.
func NonNegativeInt32(field string, value int32) error {
	if value < 0 {
		return &ValidationError{
			Field:   field,
			Value:   strconv.FormatInt(int64(value), 10),
			Rule:    "non_negative",
			Message: fmt.Sprintf("%s cannot be negative (got %d)", field, value),
			Err:     ErrOutOfRange,
		}
	}
	return nil
}

// PositiveInt validates that an integer is > 0.
func PositiveInt(field string, value int) error {
	if value <= 0 {
		return &ValidationError{
			Field:   field,
			Value:   strconv.Itoa(value),
			Rule:    "positive",
			Message: fmt.Sprintf("%s must be greater than 0 (got %d)", field, value),
			Err:     ErrOutOfRange,
		}
	}
	return nil
}

// PositiveInt32 validates that an int32 is > 0.
func PositiveInt32(field string, value int32) error {
	if value <= 0 {
		return &ValidationError{
			Field:   field,
			Value:   strconv.FormatInt(int64(value), 10),
			Rule:    "positive",
			Message: fmt.Sprintf("%s must be greater than 0 (got %d)", field, value),
			Err:     ErrOutOfRange,
		}
	}
	return nil
}

// NonEmptySlice validates that a slice has at least one element.
//
// Example:
//
//	if err := validation.NonEmptySlice("tasks", len(tasks)); err != nil {
//	    return err
//	}
func NonEmptySlice(field string, length int) error {
	if length == 0 {
		return &ValidationError{
			Field:   field,
			Value:   "[]",
			Rule:    "non_empty",
			Message: fmt.Sprintf("%s must have at least one element", field),
			Err:     ErrRequired,
		}
	}
	return nil
}

// NonEmptySliceWithMessage validates that a slice has at least one element with a custom message.
func NonEmptySliceWithMessage(field string, length int, message string) error {
	if length == 0 {
		return &ValidationError{
			Field:   field,
			Value:   "[]",
			Rule:    "non_empty",
			Message: message,
			Err:     ErrRequired,
		}
	}
	return nil
}

// NotNil validates that a pointer is not nil.
//
// Example:
//
//	if err := validation.NotNil("config.endpoint", endpoint); err != nil {
//	    return err
//	}
func NotNil(field string, value interface{}) error {
	if value == nil {
		return &ValidationError{
			Field:   field,
			Value:   "nil",
			Rule:    "required",
			Message: field + " is required",
			Err:     ErrRequired,
		}
	}
	return nil
}

// RequiredInterface validates that an interface{} value is non-empty.
//
// This handles fields that can be either string or other types (like TaskFieldRef).
// A value is considered empty if:
//   - It is nil
//   - It is an empty string
//
// Example:
//
//	if err := validation.RequiredInterface("config.in", cfg.In); err != nil {
//	    return err
//	}
func RequiredInterface(field string, value interface{}) error {
	if value == nil {
		return &ValidationError{
			Field:   field,
			Value:   "nil",
			Rule:    "required",
			Message: field + " is required",
			Err:     ErrRequired,
		}
	}
	// Check if it's a string and empty
	if s, ok := value.(string); ok && s == "" {
		return &ValidationError{
			Field:   field,
			Value:   "",
			Rule:    "required",
			Message: field + " is required",
			Err:     ErrRequired,
		}
	}
	return nil
}

// RequiredInterfaceWithMessage validates that an interface{} value is non-empty with a custom message.
func RequiredInterfaceWithMessage(field string, value interface{}, message string) error {
	if value == nil {
		return &ValidationError{
			Field:   field,
			Value:   "nil",
			Rule:    "required",
			Message: message,
			Err:     ErrRequired,
		}
	}
	// Check if it's a string and empty
	if s, ok := value.(string); ok && s == "" {
		return &ValidationError{
			Field:   field,
			Value:   "",
			Rule:    "required",
			Message: message,
			Err:     ErrRequired,
		}
	}
	return nil
}
