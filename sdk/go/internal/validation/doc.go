// Package validation provides shared error types and helpers for SDK validation.
//
// # Design Philosophy
//
// This package contains only SDK-specific validation utilities. Field-level
// validation (required fields, min/max lengths, etc.) is handled by protovalidate
// in the ToProto() methods of SDK types.
//
// This package provides:
//   - Structured error types (ValidationError, ConversionError)
//   - Sentinel errors for programmatic error handling (ErrRequired, ErrInvalidFormat, etc.)
//   - Helper functions for SDK-specific validations not covered by proto rules
//
// # Error Types
//
// ValidationError provides structured validation error information:
//
//	err := &ValidationError{
//	    Field:   "name",
//	    Value:   "invalid value",
//	    Rule:    "format",
//	    Message: "name must be lowercase alphanumeric with hyphens",
//	    Err:     ErrInvalidFormat,
//	}
//
// ConversionError is used for proto conversion failures:
//
//	err := NewConversionError("Agent", "skills", "nil skill reference")
//
// # Sentinel Errors
//
// Use errors.Is() for programmatic error handling:
//
//	if errors.Is(err, validation.ErrRequired) {
//	    // Handle missing required field
//	}
//	if errors.Is(err, validation.ErrInvalidFormat) {
//	    // Handle format error
//	}
//
// # Helper Functions
//
// FieldPath builds hierarchical field paths for nested validation:
//
//	field := validation.FieldPath("tasks", i, "name") // "tasks[0].name"
//
// MatchesPattern validates SDK-specific naming conventions:
//
//	if err := validation.MatchesPattern("name", name, nameRegex, "lowercase alphanumeric"); err != nil {
//	    return err
//	}
//
// # Proto Validation
//
// Most validation is handled by protovalidate via buf.validate rules in proto files.
// SDK types call protovalidate in their ToProto() methods:
//
//	func (a *Agent) ToProto() (*agentv1.Agent, error) {
//	    // ... build proto ...
//	    if err := validator.Validate(agent); err != nil {
//	        return nil, fmt.Errorf("agent validation failed: %w", err)
//	    }
//	    return agent, nil
//	}
package validation
