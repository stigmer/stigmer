package environment

import (
	"sync"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	genEnv "github.com/stigmer/stigmer/sdk/go/gen/environment"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
)

// EnvironmentArgs is an alias for the generated EnvironmentArgs from gen/environment.
// This provides a single source of truth for environment configuration.
type EnvironmentArgs = genEnv.EnvironmentArgs

// Context is a minimal interface that represents a stigmer context.
// This allows the environment package to work with contexts without importing
// the stigmer package (avoiding import cycles).
//
// The stigmer.Context type implements this interface.
type Context interface {
	RegisterEnvironment(*Environment)
}

// Environment represents a first-class API resource containing configuration and secrets.
//
// Environment follows the same Name/Slug/Args pattern as Agent, Workflow, McpServer.
// It holds actual env var values and is referenced by AgentInstance/WorkflowInstance
// via environment_refs.
//
// Use environment.New() with stigmer.Run() to create an Environment:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    env, err := environment.New(ctx, "production-aws", &environment.EnvironmentArgs{
//	        Description: "Production AWS credentials",
//	        Data: map[string]*environmentv1.EnvironmentValue{
//	            "AWS_REGION":        {Value: "us-west-2", IsSecret: false},
//	            "AWS_ACCESS_KEY_ID": {Value: "${secrets.aws_key}", IsSecret: true},
//	        },
//	    })
//	    return err
//	})
//
// After creation, reference the environment in AgentInstance:
//
//	import "github.com/stigmer/stigmer/sdk/go/commons/ref"
//
//	// At instance creation time:
//	envRef := ref.Environment("my-org", "production-aws")
type Environment struct {
	// Name is the environment name (lowercase alphanumeric with hyphens).
	// This is an identity field, not part of Args.
	Name string

	// Slug is the URL-friendly identifier (auto-generated from name if not provided).
	// This is an identity field, not part of Args.
	Slug string

	// Org is the organization that owns this environment (optional).
	// This is metadata, not part of Args.
	Org string

	// Args contains all configuration for this environment.
	// This is the SINGLE SOURCE OF TRUTH for configuration.
	// Uses COMPOSITION pattern - we embed the generated Args struct.
	Args *EnvironmentArgs

	// ctx is the context that this environment is registered with.
	ctx Context

	// mu protects concurrent access to mutable fields.
	mu sync.Mutex
}

// New creates a new Environment resource with struct-based args (Pulumi pattern).
//
// The environment is automatically registered with the provided context for synthesis.
// Follows Pulumi's Args pattern: name as parameter, args struct for configuration.
//
// Required:
//   - name: environment name (will be converted to slug)
//
// Optional args fields:
//   - Description: human-readable description
//   - Data: map of environment variable names to values
//
// Example:
//
//	env, err := environment.New(ctx, "production-aws", &environment.EnvironmentArgs{
//	    Description: "Production AWS credentials",
//	    Data: map[string]*environmentv1.EnvironmentValue{
//	        "AWS_REGION": {Value: "us-west-2", IsSecret: false},
//	        "AWS_ACCESS_KEY_ID": {Value: "${secrets.aws_key}", IsSecret: true},
//	    },
//	})
//
// Example with nil args (creates empty environment):
//
//	env, err := environment.New(ctx, "staging", nil)
func New(ctx Context, name string, args *EnvironmentArgs) (*Environment, error) {
	if name == "" {
		return nil, ErrNameRequired
	}

	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &EnvironmentArgs{}
	}

	// Initialize Data map if nil
	if args.Data == nil {
		args.Data = make(map[string]*environmentv1.EnvironmentValue)
	}

	e := &Environment{
		Name: name,
		Slug: naming.GenerateSlug(name),
		Args: args,
		ctx:  ctx,
	}

	// Validate slug format
	if err := naming.ValidateSlug(e.Slug); err != nil {
		return nil, err
	}

	// Register with context (if provided)
	if ctx != nil {
		ctx.RegisterEnvironment(e)
	}

	return e, nil
}

// ============================================================================
// Builder Methods - Modify Args (single source of truth)
// ============================================================================

// Set adds or updates an environment value.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	env.Set("AWS_REGION", "us-west-2", false)
//	env.Set("AWS_SECRET_KEY", "${secrets.aws_key}", true)
func (e *Environment) Set(name string, value string, isSecret bool) *Environment {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.Args.Data == nil {
		e.Args.Data = make(map[string]*environmentv1.EnvironmentValue)
	}
	e.Args.Data[name] = &environmentv1.EnvironmentValue{
		Value:    value,
		IsSecret: isSecret,
	}
	return e
}

// SetWithDescription adds or updates an environment value with a description.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	env.SetWithDescription("AWS_REGION", "us-west-2", false, "AWS region for deployments")
func (e *Environment) SetWithDescription(name, value string, isSecret bool, description string) *Environment {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.Args.Data == nil {
		e.Args.Data = make(map[string]*environmentv1.EnvironmentValue)
	}
	e.Args.Data[name] = &environmentv1.EnvironmentValue{
		Value:       value,
		IsSecret:    isSecret,
		Description: description,
	}
	return e
}

// SetSecret is a convenience method for adding a secret.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	env.SetSecret("AWS_SECRET_KEY", "${secrets.aws_key}")
func (e *Environment) SetSecret(name, value string) *Environment {
	return e.Set(name, value, true)
}

// SetConfig is a convenience method for adding a non-secret config.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	env.SetConfig("AWS_REGION", "us-west-2")
func (e *Environment) SetConfig(name, value string) *Environment {
	return e.Set(name, value, false)
}

// String returns a string representation of the Environment.
func (e *Environment) String() string {
	return "Environment(name=" + e.Name + ")"
}
