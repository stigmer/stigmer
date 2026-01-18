package environment

import (
	"fmt"
)

// Variable represents an environment variable required by an agent.
//
// Environment variables can be configuration values or secrets. They define what
// external configuration an agent needs to run.
//
// Use New() with functional options to create an environment variable:
//
//	githubToken, err := environment.New(
//	    environment.WithName("GITHUB_TOKEN"),
//	    environment.WithSecret(true),
//	    environment.WithDescription("GitHub API token"),
//	)
type Variable struct {
	// Name is the environment variable name (e.g., "GITHUB_TOKEN", "AWS_REGION").
	Name string

	// IsSecret indicates whether this value should be treated as a secret.
	// When true:
	// - Value is encrypted at rest
	// - Value is redacted in logs
	// - Value requires special permissions to read
	// When false:
	// - Value is stored as plaintext
	// - Value is visible in audit logs
	IsSecret bool

	// Description is a human-readable description of the variable.
	Description string

	// DefaultValue is the default value if not provided at instance level.
	// Only applicable for optional variables.
	DefaultValue string

	// Required indicates whether this variable must be provided.
	// Required variables without a default value must be provided at AgentInstance creation.
	Required bool
}

// Option is a functional option for configuring a Variable.
type Option func(*Variable) error

// New creates a new environment variable with the given options.
//
// Required options:
//   - WithName: variable name
//
// Example:
//
//	githubToken, err := environment.New(
//	    environment.WithName("GITHUB_TOKEN"),
//	    environment.WithSecret(true),
//	    environment.WithDescription("GitHub API token"),
//	)
//	if err != nil {
//	    log.Fatal(err)
//	}
func New(opts ...Option) (Variable, error) {
	v := Variable{
		Required: true, // Default to required
	}

	// Apply all options
	for _, opt := range opts {
		if err := opt(&v); err != nil {
			return Variable{}, err
		}
	}

	// Validate the variable
	if err := validate(&v); err != nil {
		return Variable{}, err
	}

	return v, nil
}

// WithName sets the environment variable name.
//
// The name should follow standard environment variable naming conventions:
//   - Uppercase letters
//   - Numbers
//   - Underscores
//
// This is a required field.
//
// Example:
//
//	environment.WithName("GITHUB_TOKEN")
//	environment.WithName("AWS_REGION")
func WithName(name string) Option {
	return func(v *Variable) error {
		v.Name = name
		return nil
	}
}

// WithSecret marks the variable as a secret.
//
// When true:
//   - Value is encrypted at rest
//   - Value is redacted in logs
//   - Value requires special permissions to read
//
// When false (default):
//   - Value is stored as plaintext
//   - Value is visible in audit logs
//
// Example:
//
//	environment.WithSecret(true)  // For API tokens, passwords
//	environment.WithSecret(false) // For configuration values
func WithSecret(isSecret bool) Option {
	return func(v *Variable) error {
		v.IsSecret = isSecret
		return nil
	}
}

// WithDescription sets a human-readable description of the variable.
//
// The description should explain:
//   - What the variable is used for
//   - Where to obtain the value
//   - Any format requirements
//
// Example:
//
//	environment.WithDescription("GitHub personal access token with repo scope")
//	environment.WithDescription("AWS region for resource deployment (e.g., us-east-1)")
func WithDescription(description string) Option {
	return func(v *Variable) error {
		v.Description = description
		return nil
	}
}

// WithDefaultValue sets a default value for optional variables.
//
// If a variable has a default value, it becomes optional (not required).
// The default value is used if no value is provided at AgentInstance creation.
//
// Example:
//
//	environment.WithDefaultValue("us-east-1")  // For AWS_REGION
//	environment.WithDefaultValue("info")        // For LOG_LEVEL
func WithDefaultValue(defaultValue string) Option {
	return func(v *Variable) error {
		v.DefaultValue = defaultValue
		// Variables with defaults are optional
		v.Required = false
		return nil
	}
}

// WithRequired sets whether the variable is required.
//
// Required variables must be provided at AgentInstance creation.
// Optional variables can use the default value if not provided.
//
// Note: Variables with default values are automatically marked as optional.
//
// Example:
//
//	environment.WithRequired(true)  // Must be provided
//	environment.WithRequired(false) // Optional
func WithRequired(required bool) Option {
	return func(v *Variable) error {
		v.Required = required
		return nil
	}
}

// String returns a string representation of the Variable.
func (v Variable) String() string {
	secretMarker := ""
	if v.IsSecret {
		secretMarker = " (secret)"
	}
	requiredMarker := ""
	if !v.Required {
		requiredMarker = " (optional)"
	}
	return fmt.Sprintf("EnvVar(%s%s%s)", v.Name, secretMarker, requiredMarker)
}

// validate validates the Variable configuration.
func validate(v *Variable) error {
	if v.Name == "" {
		return fmt.Errorf("environment variable name is required")
	}

	// Validate name follows environment variable conventions
	if !isValidEnvVarName(v.Name) {
		return fmt.Errorf("invalid environment variable name: %s (must be uppercase letters, numbers, and underscores)", v.Name)
	}

	// Description is optional but recommended for secrets
	if v.IsSecret && v.Description == "" {
		// Warning: not an error, but good practice
		_ = fmt.Sprintf("warning: secret variable %s has no description", v.Name)
	}

	return nil
}

// isValidEnvVarName checks if a name follows environment variable naming conventions.
func isValidEnvVarName(name string) bool {
	if len(name) == 0 {
		return false
	}

	for i, c := range name {
		if c >= 'A' && c <= 'Z' {
			continue
		}
		if c >= '0' && c <= '9' {
			// Numbers cannot be the first character
			if i == 0 {
				return false
			}
			continue
		}
		if c == '_' {
			continue
		}
		return false
	}

	return true
}
