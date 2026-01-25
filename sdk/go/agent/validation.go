package agent

import (
	"regexp"
	"strings"

	"github.com/stigmer/stigmer/sdk/go/internal/validation"
)

// Validation constants matching Python SDK rules.
const (
	// Name validation
	nameMinLength = 1
	nameMaxLength = 63

	// Instructions validation
	instructionsMinLength = 10
	instructionsMaxLength = 10000

	// Description validation
	descriptionMaxLength = 500
)

// nameRegex matches valid agent names (lowercase alphanumeric with hyphens).
var nameRegex = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

// validate validates an Agent according to the validation rules.
//
// Validation rules:
//   - Name: required, lowercase alphanumeric with hyphens, max 63 chars
//   - Instructions: required, min 10 chars, max 10,000 chars
//   - Description: optional, max 500 chars
//   - IconURL: optional, must be valid URL if provided
func validate(a *Agent) error {
	// Validate name (required)
	if err := validateName(a.Name); err != nil {
		return err
	}

	// Validate instructions (required)
	if err := validateInstructions(a.Instructions); err != nil {
		return err
	}

	// Validate description (optional)
	if a.Description != "" {
		if err := validateDescription(a.Description); err != nil {
			return err
		}
	}

	// Validate icon URL (optional)
	if a.IconURL != "" {
		if err := validateIconURL(a.IconURL); err != nil {
			return err
		}
	}

	return nil
}

// validateName validates the agent name.
//
// Rules:
//   - Required (non-empty)
//   - Lowercase alphanumeric with hyphens
//   - Must start and end with alphanumeric
//   - Max 63 characters
func validateName(name string) error {
	if err := validation.Required("name", name); err != nil {
		return validation.NewValidationErrorWithCause("name", name, "required", "name is required", ErrInvalidName)
	}

	if err := validation.MaxLength("name", name, nameMaxLength); err != nil {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"max_length",
			err.(*validation.ValidationError).Message,
			ErrInvalidName,
		)
	}

	if err := validation.MatchesPattern("name", name, nameRegex,
		"lowercase alphanumeric with hyphens, starting and ending with alphanumeric"); err != nil {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"format",
			"invalid name format: must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric",
			ErrInvalidName,
		)
	}

	return nil
}

// validateInstructions validates the agent instructions.
//
// Rules:
//   - Required (non-empty)
//   - Min 10 characters
//   - Max 10,000 characters
func validateInstructions(instructions string) error {
	if err := validation.Required("instructions", instructions); err != nil {
		return validation.NewValidationErrorWithCause("instructions", instructions, "required", "instructions are required", ErrInvalidInstructions)
	}

	// Trim whitespace for length check
	trimmed := strings.TrimSpace(instructions)
	length := len(trimmed)

	if length < instructionsMinLength {
		return validation.NewValidationErrorWithCause(
			"instructions",
			instructions,
			"min_length",
			validation.MinLengthTrimmed("instructions", instructions, instructionsMinLength).(*validation.ValidationError).Message,
			ErrInvalidInstructions,
		)
	}

	if length > instructionsMaxLength {
		return validation.NewValidationErrorWithCause(
			"instructions",
			instructions,
			"max_length",
			validation.MaxLengthTrimmed("instructions", instructions, instructionsMaxLength).(*validation.ValidationError).Message,
			ErrInvalidInstructions,
		)
	}

	return nil
}

// validateDescription validates the agent description.
//
// Rules:
//   - Optional
//   - Max 500 characters
func validateDescription(description string) error {
	if err := validation.MaxLength("description", description, descriptionMaxLength); err != nil {
		return validation.NewValidationErrorWithCause(
			"description",
			description,
			"max_length",
			err.(*validation.ValidationError).Message,
			ErrInvalidDescription,
		)
	}

	return nil
}

// validateIconURL validates the icon URL.
//
// Rules:
//   - Optional (empty is valid)
//   - Must be a valid HTTP/HTTPS URL if provided
func validateIconURL(iconURL string) error {
	// Empty is valid (optional field)
	if iconURL == "" {
		return nil
	}

	if err := validation.ValidHTTPURL("icon_url", iconURL); err != nil {
		verr := err.(*validation.ValidationError)
		return validation.NewValidationErrorWithCause(
			"icon_url",
			iconURL,
			verr.Rule,
			verr.Message,
			ErrInvalidIconURL,
		)
	}

	return nil
}
