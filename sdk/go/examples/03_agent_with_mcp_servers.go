//go:build ignore

// Example 03: Agent with MCP Server References
//
// This example demonstrates creating an agent that references MCP servers.
// MCP servers are now first-class API resources that are created separately
// and referenced by agents using their slug.
//
// MCP Server Scopes:
//   - Platform: Public/marketplace servers, visible to all users
//   - Organization: Private to org members
//   - Personal: Private to the individual user
//
// Note: MCP servers are created separately via:
//   - CLI: `stigmer mcpserver apply -f mcpserver.yaml`
//   - API: Using the McpServer command controller
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/mcpserverref"
	"github.com/stigmer/stigmer/sdk/go/skillref"
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
		// Add Platform MCP Server References
		// =============================================================================
		// Platform servers are publicly available on the marketplace.
		// Use mcpserverref.Platform() to reference them.

		// Reference GitHub MCP server with specific tools enabled
		a.AddMcpServerUsage(
			mcpserverref.Platform("github"),
			"create_issue", "list_repos", "create_pr", "search_code",
		)

		// Reference AWS MCP server (all tools enabled)
		a.AddMcpServerUsage(
			mcpserverref.Platform("aws"),
		)

		// Reference Slack MCP server
		a.AddMcpServerUsage(
			mcpserverref.Platform("slack"),
			"send_message", "list_channels",
		)

		// =============================================================================
		// Add Organization MCP Server References
		// =============================================================================
		// Organization servers are private to the org.
		// Use mcpserverref.Organization() to reference them.

		a.AddMcpServerUsage(
			mcpserverref.Organization("acme-corp", "internal-tools"),
			"deploy", "rollback", "check_status",
		)

		// =============================================================================
		// Convenience Methods
		// =============================================================================
		// UseMCPServer() is a shorthand for platform-scoped servers

		a.UseMCPServer("docker", "build", "push", "pull")

		// UseOrgMCPServer() is a shorthand for org-scoped servers
		// (requires agent.Org to be set)

		// =============================================================================
		// Add Personal MCP Server Reference
		// =============================================================================
		// Personal servers are private to the individual user.
		// Useful for personal development tools or custom configurations.

		a.AddMcpServerUsage(
			mcpserverref.Personal("my-dev-tools"),
		)

		// =============================================================================
		// Add Skill References
		// =============================================================================
		a.AddSkillRefs(
			skillref.Platform("devops-best-practices"),
			skillref.Platform("cloud-infrastructure"),
		)

		// =============================================================================
		// Display Agent Configuration
		// =============================================================================
		fmt.Println("=== Agent Configuration ===")
		fmt.Printf("Name: %s\n", a.Name)
		fmt.Printf("Instructions: %s...\n", a.Instructions[:80])
		fmt.Printf("Skill Refs: %d\n", len(a.SkillRefs))
		fmt.Printf("MCP Server Usages: %d\n\n", len(a.McpServerUsages))

		// Display MCP server usages
		fmt.Println("=== MCP Server Usages ===")
		for i, usage := range a.McpServerUsages {
			ref := usage.McpServerRef
			fmt.Printf("%d. %s (scope: %s)\n", i+1, ref.Slug, ref.Scope.String())
			if len(usage.EnabledTools) > 0 {
				fmt.Printf("   Enabled tools: %v\n", usage.EnabledTools)
			} else {
				fmt.Println("   Enabled tools: all (using server defaults)")
			}
		}

		fmt.Println("\n=== Summary ===")
		fmt.Println("Created agent with MCP server references:")
		fmt.Println("  - Platform servers: 4 (github, aws, slack, docker)")
		fmt.Println("  - Organization servers: 1 (internal-tools)")
		fmt.Println("  - Personal servers: 1 (my-dev-tools)")
		fmt.Println()
		fmt.Println("Key differences from old inline pattern:")
		fmt.Println("  - MCP servers are now standalone API resources")
		fmt.Println("  - Agents reference servers by slug, not define them inline")
		fmt.Println("  - Server configurations (command, args, etc.) are in McpServer resources")
		fmt.Println("  - Agents only specify which tools to enable from each server")
		fmt.Println()
		fmt.Println("Note: Run `stigmer deploy` to deploy this agent to the platform.")

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
