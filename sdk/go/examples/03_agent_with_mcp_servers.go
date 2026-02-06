//go:build ignore

// Example 03: Agent with MCP Server References
//
// This example demonstrates creating an agent that references MCP servers.
// MCP servers are first-class API resources that are created separately
// and referenced by agents using the org/slug format.
//
// All MCP servers belong to an organization:
//   - Public servers (e.g., stigmer/github) are available to all users
//   - Private servers (e.g., my-org/internal-tools) are only visible to org members
//
// Note: MCP servers are created separately via:
//   - CLI: `stigmer mcpserver apply -f mcpserver.yaml`
//   - API: Using the McpServer command controller
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// =============================================================================
		// Create Agent with MCP Server References
		// =============================================================================
		a, err := agent.New(ctx, "devops-agent", &agent.AgentArgs{
			Instructions: `You are a DevOps automation agent with access to multiple tools.

You have access to:
- GitHub (create issues, PRs, list repos)
- AWS services (via AWS CLI MCP)
- Internal tools (organization-specific)

Use these tools to help with infrastructure automation, deployments, and DevOps workflows.`,
			Description: "DevOps automation agent with GitHub, AWS, and internal MCP servers",
			IconUrl:     "https://example.com/devops-agent.png",
		})
		if err != nil {
			return fmt.Errorf("failed to create agent: %w", err)
		}

		// =============================================================================
		// Add Public MCP Server References (from stigmer org)
		// =============================================================================
		// Public servers are available to all users on the platform.
		// Use the org/slug format to reference them.

		// Reference GitHub MCP server with specific tools enabled
		a.UseMCP("stigmer/github", "create_issue", "list_repos", "create_pr", "search_code")

		// Reference AWS MCP server (all tools enabled)
		a.UseMCP("stigmer/aws")

		// Reference Slack MCP server
		a.UseMCP("stigmer/slack", "send_message", "list_channels")

		// Reference Docker MCP server
		a.UseMCP("stigmer/docker", "build", "push", "pull")

		// =============================================================================
		// Add Private Organization MCP Server References
		// =============================================================================
		// Private servers are only visible to your organization.
		// Use the org/slug format to reference them.

		a.UseMCP("acme-corp/internal-tools", "deploy", "rollback", "check_status")

		// =============================================================================
		// Using agent.Org for slug-only references
		// =============================================================================
		// When agent.Org is set, you can use slug-only references
		// which will automatically use the agent's org.

		a.Org = "my-org"
		a.UseMCP("my-dev-tools") // Resolves to my-org/my-dev-tools

		// =============================================================================
		// Add Skill References using the new API
		// =============================================================================
		a.AddSkills(
			"stigmer/devops-best-practices",
			"stigmer/cloud-infrastructure",
		)

		// =============================================================================
		// Display Agent Configuration
		// =============================================================================
		fmt.Println("=== Agent Configuration ===")
		fmt.Printf("Name: %s\n", a.Name)
		fmt.Printf("Org: %s\n", a.Org)
		fmt.Printf("Instructions: %s...\n", a.Args.Instructions[:80])
		fmt.Printf("Skill Refs: %d\n", len(a.Args.SkillRefs))
		fmt.Printf("MCP Server Usages: %d\n\n", len(a.Args.McpServerUsages))

		// Display MCP server usages
		fmt.Println("=== MCP Server Usages ===")
		for i, usage := range a.Args.McpServerUsages {
			ref := usage.McpServerRef
			fmt.Printf("%d. %s/%s\n", i+1, ref.Org, ref.Slug)
			if len(usage.EnabledTools) > 0 {
				fmt.Printf("   Enabled tools: %v\n", usage.EnabledTools)
			} else {
				fmt.Println("   Enabled tools: all (using server defaults)")
			}
		}

		fmt.Println("\n=== Summary ===")
		fmt.Println("Created agent with MCP server references:")
		fmt.Println("  - Public servers: 4 (stigmer/github, stigmer/aws, stigmer/slack, stigmer/docker)")
		fmt.Println("  - Private servers: 2 (acme-corp/internal-tools, my-org/my-dev-tools)")
		fmt.Println()
		fmt.Println("Key concepts:")
		fmt.Println("  - MCP servers are standalone API resources")
		fmt.Println("  - Use org/slug format to reference servers")
		fmt.Println("  - Set agent.Org for slug-only references")
		fmt.Println("  - Use UseMCP() with optional tool list")
		fmt.Println()
		fmt.Println("Note: Run `stigmer deploy` to deploy this agent to the platform.")

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
