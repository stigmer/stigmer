package agent

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
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
	if name == "" {
		return NewValidationErrorWithCause("name", name, "required", "name is required", ErrInvalidName)
	}

	if len(name) > nameMaxLength {
		return NewValidationErrorWithCause(
			"name",
			name,
			"max_length",
			fmt.Sprintf("name must be at most %d characters (got %d)", nameMaxLength, len(name)),
			ErrInvalidName,
		)
	}

	if !nameRegex.MatchString(name) {
		return NewValidationErrorWithCause(
			"name",
			name,
			"format",
			"name must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric",
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
	if instructions == "" {
		return NewValidationErrorWithCause("instructions", instructions, "required", "instructions are required", ErrInvalidInstructions)
	}

	// Trim whitespace for length check
	trimmed := strings.TrimSpace(instructions)
	length := len(trimmed)

	if length < instructionsMinLength {
		return NewValidationErrorWithCause(
			"instructions",
			instructions,
			"min_length",
			fmt.Sprintf("instructions must be at least %d characters (got %d)", instructionsMinLength, length),
			ErrInvalidInstructions,
		)
	}

	if length > instructionsMaxLength {
		return NewValidationErrorWithCause(
			"instructions",
			instructions,
			"max_length",
			fmt.Sprintf("instructions must be at most %d characters (got %d)", instructionsMaxLength, length),
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
	if len(description) > descriptionMaxLength {
		return NewValidationErrorWithCause(
			"description",
			description,
			"max_length",
			fmt.Sprintf("description must be at most %d characters (got %d)", descriptionMaxLength, len(description)),
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

	parsedURL, err := url.Parse(iconURL)
	if err != nil {
		return NewValidationErrorWithCause(
			"icon_url",
			iconURL,
			"url_format",
			"icon_url must be a valid URL",
			ErrInvalidIconURL,
		)
	}

	// Must have a scheme (http or https)
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return NewValidationErrorWithCause(
			"icon_url",
			iconURL,
			"url_scheme",
			"icon_url must use http or https scheme",
			ErrInvalidIconURL,
		)
	}

	// Must have a host
	if parsedURL.Host == "" {
		return NewValidationErrorWithCause(
			"icon_url",
			iconURL,
			"url_host",
			"icon_url must have a valid host",
			ErrInvalidIconURL,
		)
	}

	return nil
}
