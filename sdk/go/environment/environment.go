package environment

import (
	"fmt"
	"regexp"

	"github.com/stigmer/stigmer/sdk/go/internal/validation"
)

// Context is a minimal interface that represents a stigmer context.
// This allows the environment package to work with contexts without importing
// the stigmer package (avoiding import cycles).
//
// The stigmer.Context type implements this interface.
type Context interface {
	// Environment variables are helper types, not registered resources.
	// Context is included for consistency with Pulumi patterns.
}

// VariableArgs contains the configuration arguments for creating an environment Variable.
//
// This struct follows the Pulumi Args pattern for resource configuration.
type VariableArgs struct {
	// IsSecret indicates whether this value should be treated as a secret.
	// When true:
	// - Value is encrypted at rest
	// - Value is redacted in logs
	// - Value requires special permissions to read
	// When false (default):
	// - Value is stored as plaintext
	// - Value is visible in audit logs
	IsSecret bool

	// Description is a human-readable description of the variable.
	// Recommended for all variables, especially secrets, to document
	// their purpose and expected format.
	Description string

	// DefaultValue is the default value if not provided at instance level.
	// Only applicable for optional variables.
	// Setting a default value automatically marks the variable as optional.
	DefaultValue string

	// Required indicates whether this variable must be provided.
	// Defaults to true. Variables with default values are automatically optional.
	Required *bool
}

// Variable represents an environment variable required by an agent.
//
// Environment variables can be configuration values or secrets. They define what
// external configuration an agent needs to run.
//
// Use New() with struct args (Pulumi pattern) to create an environment variable:
//
//	githubToken, err := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
//	    IsSecret:    true,
//	    Description: "GitHub API token",
//	})
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

// envVarNameRegex matches valid environment variable names.
// Must be uppercase letters, numbers, and underscores, not starting with a number.
var envVarNameRegex = regexp.MustCompile(`^[A-Z_][A-Z0-9_]*$`)

// New creates a new environment variable with struct-based args (Pulumi pattern).
//
// Follows Pulumi's Args pattern: context, name as parameters, struct args for configuration.
//
// Required:
//   - ctx: stigmer context (for consistency with other resources)
//   - name: variable name (uppercase letters, numbers, underscores)
//
// Optional args fields:
//   - IsSecret: whether the value should be treated as a secret
//   - Description: human-readable description
//   - DefaultValue: default value (makes the variable optional)
//   - Required: whether the variable is required (defaults to true)
//
// Example:
//
//	githubToken, err := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
//	    IsSecret:    true,
//	    Description: "GitHub API token",
//	})
//	if err != nil {
//	    log.Fatal(err)
//	}
//
// Example with default value (makes variable optional):
//
//	awsRegion, err := environment.New(ctx, "AWS_REGION", &environment.VariableArgs{
//	    DefaultValue: "us-east-1",
//	    Description:  "AWS region for deployment",
//	})
//
// Example with nil args (creates required variable):
//
//	apiKey, err := environment.New(ctx, "API_KEY", nil)
func New(ctx Context, name string, args *VariableArgs) (*Variable, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &VariableArgs{}
	}

	// Determine if required
	required := true
	if args.Required != nil {
		required = *args.Required
	}
	// Variables with defaults are optional
	if args.DefaultValue != "" {
		required = false
	}

	v := &Variable{
		Name:         name,
		IsSecret:     args.IsSecret,
		Description:  args.Description,
		DefaultValue: args.DefaultValue,
		Required:     required,
	}

	// Validate the variable
	if err := validate(v); err != nil {
		return nil, err
	}

	return v, nil
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
	if err := validation.RequiredWithMessage("name", v.Name, "environment variable name is required"); err != nil {
		return err
	}

	// Validate name follows environment variable conventions
	if err := validation.MatchesPattern("name", v.Name, envVarNameRegex,
		"uppercase letters, numbers, and underscores (not starting with a number)"); err != nil {
		return validation.NewValidationErrorWithCause(
			"name",
			v.Name,
			"format",
			fmt.Sprintf("invalid environment variable name: %s (must be uppercase letters, numbers, and underscores)", v.Name),
			validation.ErrInvalidFormat,
		)
	}

	return nil
}
