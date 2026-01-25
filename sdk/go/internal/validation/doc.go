// Package validation provides shared validation utilities for the Stigmer Go SDK.
//
// This internal package eliminates duplicate validation code across SDK packages
// (agent, workflow, mcpserver, subagent, environment) by providing:
//
//   - Structured error types (ValidationError, ConversionError)
//   - Common validation functions (Required, MinLength, MaxLength, etc.)
//   - Field path utilities for nested validation
//   - Sentinel errors for programmatic error handling
//
// # Error Types
//
// ValidationError provides structured context for validation failures:
//
//	err := validation.Required("name", "")
//	// err.Field = "name"
//	// err.Rule = "required"
//	// errors.Is(err, validation.ErrRequired) == true
//
// ConversionError provides context for proto conversion failures:
//
//	err := validation.NewConversionError("Agent", "skills", "nil skill reference")
//
// # Validation Functions
//
// All validation functions return nil on success or *ValidationError on failure:
//
//	if err := validation.Required("name", agent.Name); err != nil {
//	    return err
//	}
//	if err := validation.MaxLength("description", agent.Description, 500); err != nil {
//	    return err
//	}
//
// # Field Paths
//
// Use FieldPath to build hierarchical paths for nested validation:
//
//	// Simple field
//	field := validation.FieldPath("name") // "name"
//
//	// Nested field
//	field := validation.FieldPath("config", "timeout") // "config.timeout"
//
//	// Array element
//	field := validation.FieldPath("volumes", i, "host_path") // "volumes[0].host_path"
//
// # Sentinel Errors
//
// Use errors.Is() to check for specific error types:
//
//	if errors.Is(err, validation.ErrRequired) {
//	    // Handle missing required field
//	}
//	if errors.Is(err, validation.ErrOutOfRange) {
//	    // Handle numeric value out of range
//	}
//
// Available sentinel errors:
//   - ErrRequired: field is required
//   - ErrMinLength: value below minimum length
//   - ErrMaxLength: value exceeds maximum length
//   - ErrInvalidFormat: value doesn't match expected format
//   - ErrInvalidURL: invalid URL
//   - ErrOutOfRange: numeric value out of range
//   - ErrInvalidEnum: value not in allowed set
//   - ErrConversion: proto conversion failed
//
// # Example Usage
//
// Validating an agent:
//
//	func validate(a *Agent) error {
//	    if err := validation.Required("name", a.Name); err != nil {
//	        return err
//	    }
//	    if err := validation.MaxLength("name", a.Name, 63); err != nil {
//	        return err
//	    }
//	    if err := validation.MatchesPattern("name", a.Name, nameRegex,
//	        "lowercase alphanumeric with hyphens"); err != nil {
//	        return err
//	    }
//	    return nil
//	}
//
// Validating nested structures:
//
//	for i, vol := range server.Volumes {
//	    if err := validation.Required(
//	        validation.FieldPath("volumes", i, "host_path"),
//	        vol.HostPath,
//	    ); err != nil {
//	        return err
//	    }
//	}
package validation
