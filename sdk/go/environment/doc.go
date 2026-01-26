// Package environment provides types and builders for defining environment variables
// in Stigmer agents.
//
// Environment variables can be configuration values or secrets. They define what
// external configuration an agent needs to run, with support for default values
// and marking sensitive data.
//
// # Basic Usage
//
// Create environment variables using struct-based args:
//
//	// Required secret
//	githubToken, err := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
//	    IsSecret:    true,
//	    Description: "GitHub API token",
//	})
//
//	// Optional config with default
//	region, err := environment.New(ctx, "AWS_REGION", &environment.VariableArgs{
//	    DefaultValue: "us-east-1",
//	    Description:  "AWS region for deployments",
//	})
//
// # Secret vs Configuration
//
// Environment variables can be marked as secrets:
//   - Secrets (is_secret=true): Encrypted at rest, redacted in logs
//   - Configuration (is_secret=false): Stored as plaintext, visible in audit logs
//
// # Required vs Optional
//
// Variables can be required or optional:
//   - Required (default): Must be provided at AgentInstance creation
//   - Optional: Can use default value if not provided
//
// # Integration with Agent
//
// Add environment variables to agents using builder methods:
//
//	agent, err := agent.New(ctx, "github-bot", &agent.AgentArgs{
//	    Instructions: "Manage GitHub repositories",
//	})
//	agent.AddEnvironmentVariable(githubToken)
//	agent.AddEnvironmentVariable(region)
//
// # Proto Conversion
//
// The package converts to protobuf EnvironmentSpec messages:
//
//	proto := environment.ToEnvironmentSpec(variables)
//
// This proto representation is used when creating Agent resources in the
// Stigmer platform.
package environment
