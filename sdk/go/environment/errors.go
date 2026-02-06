package environment

import "errors"

// Sentinel errors for environment operations.
var (
	// ErrNameRequired is returned when the environment name is empty.
	ErrNameRequired = errors.New("environment: name is required")
)
