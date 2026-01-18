// Package environment provides types and builders for defining environment variables
// in Stigmer agents.
//
// Environment variables can be configuration values or secrets. They define what
// external configuration an agent needs to run, with support for default values
// and marking sensitive data.
//
// # Basic Usage
//
// Create environment variables using builder functions:
//
//	// Required secret
//	githubToken, err := environment.New(
//	    environment.WithName("GITHUB_TOKEN"),
//	    environment.WithSecret(true),
//	    environment.WithDescription("GitHub API token"),
//	)
//
//	// Optional config with default
//	region, err := environment.New(
//	    environment.WithName("AWS_REGION"),
//	    environment.WithDefaultValue("us-east-1"),
//	    environment.WithDescription("AWS region for deployments"),
//	)
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
// Add environment variables to agents:
//
//	agent, err := agent.New(
//	    agent.WithName("github-bot"),
//	    agent.WithInstructions("Manage GitHub repositories"),
//	    agent.WithEnvironmentVariable(githubToken),
//	    agent.WithEnvironmentVariable(region),
//	)
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
