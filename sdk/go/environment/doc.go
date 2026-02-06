// Package environment provides the Environment resource type for defining
// collections of configuration values and secrets in Stigmer.
//
// Environment is a first-class API resource that holds actual env var values.
// It follows the same Name/Slug/Args pattern as Agent, Workflow, McpServer.
// Environments are created separately and referenced during AgentInstance or
// WorkflowInstance creation via environment_refs.
//
// # Basic Usage
//
// Create an Environment resource using struct-based args:
//
//	import (
//	    "github.com/stigmer/stigmer/sdk/go/environment"
//	    environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
//	)
//
//	env, err := environment.New(ctx, "production-aws", &environment.EnvironmentArgs{
//	    Description: "Production AWS credentials",
//	    Data: map[string]*environmentv1.EnvironmentValue{
//	        "AWS_REGION":        {Value: "us-west-2", IsSecret: false},
//	        "AWS_ACCESS_KEY_ID": {Value: "${secrets.aws_key}", IsSecret: true},
//	    },
//	})
//
// # Builder Pattern
//
// Use builder methods for fluent configuration:
//
//	env, _ := environment.New(ctx, "production-aws", nil)
//	env.SetConfig("AWS_REGION", "us-west-2").
//	    SetSecret("AWS_ACCESS_KEY_ID", "${secrets.aws_key}").
//	    SetSecret("AWS_SECRET_ACCESS_KEY", "${secrets.aws_secret}")
//
// # Secret vs Configuration
//
// Environment values can be marked as secrets:
//   - Secrets (is_secret=true): Encrypted at rest, redacted in logs
//   - Configuration (is_secret=false): Stored as plaintext, visible in audit logs
//
// # Referencing Environments
//
// Use the ref package to reference environments in instance creation:
//
//	import "github.com/stigmer/stigmer/sdk/go/ref"
//
//	envRef := ref.Environment("my-org", "production-aws")
//	// Use envRef in AgentInstance.environment_refs
//
// # Architecture Note
//
// This package provides the Environment RESOURCE (first-class API object with
// actual values). For declaring what env vars an Agent/Workflow NEEDS (template
// level requirements), use Args.EnvSpec directly on the Agent/Workflow:
//
//	ag.RequireSecret("GITHUB_TOKEN", "GitHub API token")
//	ag.RequireConfig("AWS_REGION", "us-east-1", "AWS region")
//
// This ensures a single source of truth using the generated EnvironmentSpec
// from the proto definition.
package environment
