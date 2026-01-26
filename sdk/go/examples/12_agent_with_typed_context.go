//go:build ignore

// Example 12: Agent with Typed Context
//
// This example demonstrates creating an agent using typed context variables.
// Typed context provides compile-time safety and IDE autocomplete for
// configuration values that can be shared across agents and workflows.
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skillref"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// This example demonstrates creating an agent with typed context variables.
//
// The agent:
//  1. Uses typed context for configuration (agentName, iconURL, etc.)
//  2. Shares context with workflows (if needed)
//  3. Provides compile-time safety and IDE autocomplete
//
// Key features demonstrated:
//   - stigmer.Run() pattern for automatic context management
//   - Typed context variables (agentName, iconURL, org)
//   - Compile-time checked references (no string typos)
//   - IDE autocomplete for context variables
//   - Struct-args pattern for environment and mcpserver
//   - Automatic synthesis on completion
func main() {
	// Use stigmer.Run() for automatic context and synthesis management
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create typed context variables (compile-time checked!)
		agentName := ctx.SetString("agentName", "code-reviewer")
		baseIconURL := ctx.SetString("baseIconURL", "https://example.com")
		orgName := ctx.SetString("orgName", "my-organization")

		// Type-safe string concatenation for icon URL
		iconURL := baseIconURL.Concat("/icons/code-reviewer.png")

		// Create environment variable using struct-args pattern
		githubToken, err := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
			IsSecret:    true,
			Description: "GitHub personal access token for code review",
		})
		if err != nil {
			return err
		}

		// Create MCP server using struct-args pattern
		githubMCP, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-github"},
			EnvPlaceholders: map[string]string{
				"GITHUB_TOKEN": "${GITHUB_TOKEN}",
			},
		})
		if err != nil {
			return err
		}

		// Create the agent with typed context values
		// Use .Value() to convert typed references to strings
		ag, err := agent.New(ctx, agentName.Value(), &agent.AgentArgs{
			Instructions: "Review code and suggest improvements based on best practices, security considerations, and coding standards",
			Description:  "Professional code reviewer with security focus",
			IconUrl:      iconURL.Value(),
		})
		if err != nil {
			return err
		}

		// Set Org field directly using typed context
		ag.Org = orgName.Value()

		// Add skill references using skillref package
		ag.AddSkillRefs(
			skillref.Platform("coding-best-practices"),
			skillref.Platform("security-review"),
		)

		// Add MCP server and environment variable
		ag.AddMCPServer(githubMCP)
		ag.AddEnvironmentVariable(*githubToken)

		log.Printf("Created agent: %s", ag)
		log.Printf("  - Organization: %s", ag.Org)
		log.Printf("  - Icon URL: %s", ag.IconURL)
		log.Printf("  - Skill Refs: %d", len(ag.SkillRefs))
		log.Printf("  - MCP Servers: %d", len(ag.MCPServers))
		log.Printf("  - Environment Variables: %d", len(ag.EnvironmentVariables))
		log.Println("Agent will be synthesized automatically on completion")
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("Agent created and synthesized successfully!")
}
