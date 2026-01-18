// Package agent provides the core Agent builder for defining AI agent templates.
//
// The agent package implements the functional options pattern to provide a
// flexible, type-safe API for building agent configurations that convert to
// protobuf messages.
//
// # Basic Usage
//
//	import "github.com/stigmer/stigmer/sdk/go/stigmer"
//	import "github.com/stigmer/stigmer/sdk/go/agent"
//	
//	func main() {
//	    err := stigmer.Run(func(ctx *stigmer.Context) error {
//	        ag, err := agent.New(ctx,
//	            agent.WithName("code-reviewer"),
//	            agent.WithInstructions("Review code and suggest improvements"),
//	            agent.WithDescription("AI code reviewer"),
//	        )
//	        return err
//	    })
//	    if err != nil {
//	        log.Fatal(err)
//	    }
//	}
//
// # Synthesis Model
//
// The SDK uses stigmer.Run() for automatic manifest synthesis:
//
//  1. Define agents using agent.New() inside stigmer.Run()
//  2. Agents are automatically registered in the context
//  3. When stigmer.Run() completes, manifests are automatically synthesized
//  4. The CLI reads manifest.pb and deploys to the platform
//
// This approach provides clean API ergonomics while maintaining Go's explicit style.
//
// # Validation
//
// All agent fields are validated during construction:
//
//   - Name: lowercase alphanumeric + hyphens, max 63 characters
//   - Instructions: min 10 characters, max 10,000 characters
//   - Description: max 500 characters (optional)
//   - IconURL: valid URL format (optional)
//
// Validation errors are returned from NewWithContext() and provide detailed context.
//
// # Proto Conversion
//
// Agents can be converted to protobuf messages:
//
//	proto := agent.ToProto()
//	// proto is *agentv1.AgentSpec
//
// The proto conversion is designed to be lossless - all information in the
// Go Agent struct is preserved in the protobuf message.
//
// # Configuration Options
//
// The following options are available:
//
//   - WithName: Set the agent name (required)
//   - WithInstructions: Set behavior instructions (required)
//   - WithDescription: Set human-readable description
//   - WithIconURL: Set icon URL for UI display
//   - WithOrg: Set organization owner
//   - WithSkill: Add a skill reference
//   - WithSkills: Add multiple skill references
//   - WithMCPServer: Add an MCP server definition
//   - WithMCPServers: Add multiple MCP server definitions
//   - WithSubAgent: Add a sub-agent
//   - WithSubAgents: Add multiple sub-agents
//   - WithEnvVar: Add an environment variable
//   - WithEnvVars: Add multiple environment variables
//
// # Error Handling
//
// The package provides specific error types for different failure modes:
//
//   - ValidationError: Field validation failures
//   - ConversionError: Proto conversion failures
//
// Common validation errors are also exported as sentinel errors:
//
//   - ErrInvalidName
//   - ErrInvalidInstructions
//   - ErrInvalidDescription
//   - ErrInvalidIconURL
package agent
