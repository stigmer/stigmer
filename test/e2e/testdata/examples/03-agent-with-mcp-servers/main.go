//go:build ignore
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// This example demonstrates creating an agent with all three types of MCP servers:
// 1. Stdio server (subprocess-based, most common)
// 2. HTTP server (remote services)
// 3. Docker server (containerized)
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create Stdio MCP Server (GitHub)
		// Most common type - runs as subprocess with stdin/stdout communication
		githubServer, err := mcpserver.Stdio(
			mcpserver.WithName("github"),
			mcpserver.WithCommand("npx"),
			mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
			mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
			mcpserver.WithWorkingDir("/app/mcp-servers"),
			mcpserver.WithEnabledTools("create_issue", "list_repos", "create_pr"),
		)
		if err != nil {
			return fmt.Errorf("failed to create GitHub MCP server: %w", err)
		}

		// Create HTTP MCP Server (remote API service)
		// Used for managed/remote MCP services
		apiServer, err := mcpserver.HTTP(
			mcpserver.WithName("api-service"),
			mcpserver.WithURL("https://mcp.example.com/api"),
			mcpserver.WithHeader("Authorization", "Bearer ${API_TOKEN}"),
			mcpserver.WithHeader("X-API-Version", "v1"),
			mcpserver.WithQueryParam("region", "${AWS_REGION}"),
			mcpserver.WithQueryParam("environment", "production"),
			mcpserver.WithTimeout(60),
			mcpserver.WithEnabledTools("search", "fetch", "analyze"),
		)
		if err != nil {
			return fmt.Errorf("failed to create API MCP server: %w", err)
		}

		// Create Docker MCP Server (containerized)
		// Used for custom/isolated MCP servers with volume mounts and networking
		customServer, err := mcpserver.Docker(
			mcpserver.WithName("custom-mcp"),
			mcpserver.WithImage("ghcr.io/myorg/custom-mcp:latest"),
			mcpserver.WithArgs("--config", "/etc/mcp/config.yaml", "--verbose"),
			mcpserver.WithEnvPlaceholder("API_KEY", "${CUSTOM_API_KEY}"),
			mcpserver.WithEnvPlaceholder("DATABASE_URL", "${DATABASE_URL}"),
			mcpserver.WithVolumeMount("/host/data", "/mnt/data", false),
			mcpserver.WithVolumeMount("/host/config", "/etc/mcp", true), // read-only
			mcpserver.WithPortMapping(8080, 80, "tcp"),
			mcpserver.WithPortMapping(8443, 443, "tcp"),
			mcpserver.WithNetwork("mcp-network"),
			mcpserver.WithContainerName("my-custom-mcp"),
			mcpserver.WithEnabledTools("process_data", "generate_report"),
		)
		if err != nil {
			return fmt.Errorf("failed to create custom Docker MCP server: %w", err)
		}

		// Create another Stdio server (AWS CLI)
		awsServer, err := mcpserver.Stdio(
			mcpserver.WithName("aws"),
			mcpserver.WithCommand("npx"),
			mcpserver.WithArgs("-y", "@modelcontextprotocol/server-aws"),
			mcpserver.WithEnvPlaceholder("AWS_ACCESS_KEY_ID", "${AWS_ACCESS_KEY_ID}"),
			mcpserver.WithEnvPlaceholder("AWS_SECRET_ACCESS_KEY", "${AWS_SECRET_ACCESS_KEY}"),
			mcpserver.WithEnvPlaceholder("AWS_REGION", "${AWS_REGION}"),
		)
		if err != nil {
			return fmt.Errorf("failed to create AWS MCP server: %w", err)
		}

		// Create agent with all MCP servers
		a, err := agent.New(ctx,
			agent.WithName("devops-agent"),
			agent.WithInstructions(`You are a DevOps automation agent with access to multiple tools.

You have access to:
- GitHub (create issues, PRs, list repos)
- AWS services (via AWS CLI MCP)
- API service (search, fetch, analyze data)
- Custom MCP server (process data, generate reports)

Use these tools to help with infrastructure automation, deployments, and DevOps workflows.`),
			agent.WithDescription("DevOps automation agent with GitHub, AWS, API, and custom MCP servers"),
			agent.WithIconURL("https://example.com/devops-agent.png"),
			agent.WithSkills(
				skill.Platform("devops-best-practices"),
				skill.Platform("cloud-infrastructure"),
			),
			// Add all MCP servers
			agent.WithMCPServers(
				githubServer,
				apiServer,
				customServer,
				awsServer,
			),
		)
		if err != nil {
			return fmt.Errorf("failed to create agent: %w", err)
		}

		// Display agent configuration
		fmt.Println("=== Agent Configuration ===")
		fmt.Printf("Name: %s\n", a.Name)
		fmt.Printf("Instructions: %s\n", a.Instructions[:100]+"...")
		fmt.Printf("Skills: %d\n", len(a.Skills))
		fmt.Printf("MCP Servers: %d\n\n", len(a.MCPServers))

		// Display MCP servers
		fmt.Println("=== MCP Servers ===")
		for i, server := range a.MCPServers {
			fmt.Printf("%d. %s\n", i+1, server.Name())
			tools := server.EnabledTools()
			if len(tools) > 0 {
				fmt.Printf("   Enabled tools: %v\n", tools)
			} else {
				fmt.Println("   Enabled tools: all")
			}
		}

		fmt.Println("\n=== Summary ===")
		fmt.Println("✓ Created agent with 4 MCP servers")
		fmt.Println("✓ Stdio servers: 2 (GitHub, AWS)")
		fmt.Println("✓ HTTP servers: 1 (API service)")
		fmt.Println("✓ Docker servers: 1 (Custom MCP)")
		fmt.Println("✓ All servers configured with:")
		fmt.Println("  - Environment variable placeholders")
		fmt.Println("  - Enabled tool selections")
		fmt.Println("  - Type-specific configurations")
		fmt.Println("\nNote: When you run `stigmer deploy`, the CLI will convert this to proto and deploy to Stigmer.")

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
