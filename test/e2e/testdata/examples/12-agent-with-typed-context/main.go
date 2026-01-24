//go:build ignore

// Package examples demonstrates how to create agents using the Stigmer SDK with typed context.
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// This example demonstrates creating an agent with typed context variables.
//
// The agent:
// 1. Uses typed context for configuration (agentName, iconURL, etc.)
// 2. Shares context with workflows (if needed)
// 3. Provides compile-time safety and IDE autocomplete
//
// Key features demonstrated:
// - stigmer.Run() pattern for automatic context management
// - Typed context variables (agentName, iconURL, org)
// - Compile-time checked references (no string typos)
// - IDE autocomplete for context variables
// - Type-safe agent builders accepting Ref types
// - Automatic synthesis on completion
func main() {
	// Use stigmer.Run() for automatic context and synthesis management
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create typed context variables (compile-time checked!)
		agentName := ctx.SetString("agentName", "code-reviewer")
		baseIconURL := ctx.SetString("baseIconURL", "https://example.com")
		orgName := ctx.SetString("orgName", "my-organization")

		// Type-safe string concatenation for icon URL
		iconURL := baseIconURL.Concat("/icons/code-reviewer.png")

		// Create environment variable for GitHub token
		githubToken, err := environment.New(
			environment.WithName("GITHUB_TOKEN"),
			environment.WithSecret(true),
			environment.WithDescription("GitHub personal access token for code review"),
		)
		if err != nil {
			return err
		}

		// Create MCP server for GitHub integration
		githubMCP, err := mcpserver.Stdio(
			mcpserver.WithName("github"),
			mcpserver.WithCommand("npx"),
			mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
		)
		if err != nil {
			return err
		}

		// Create the agent with typed context
		// Note: We're using the typed references via .Value() to get string values
		ag, err := agent.New(ctx, agentName.Value(), &agent.AgentArgs{
			// Required field
			Instructions: "Review code and suggest improvements based on best practices, security considerations, and coding standards",

			// Optional fields with typed context
			Description: "Professional code reviewer with security focus",
			IconUrl:     iconURL.Value(), // Convert StringRef to string
		})
		if err != nil {
			return err
		}

		// Set Org field directly (not in AgentArgs)
		ag.Org = orgName.Value()

		// Add skills, MCP servers, and environment variables using builder methods
		ag.AddSkills(
			skill.Platform("coding-best-practices"),
			skill.Platform("security-review"),
		)
		ag.AddMCPServer(githubMCP)
		ag.AddEnvironmentVariable(githubToken)

		log.Printf("Created agent: %s", ag)
		log.Println("Agent will be synthesized automatically on completion")
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Agent created and synthesized successfully!")
}
