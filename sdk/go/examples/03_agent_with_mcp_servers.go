//go:build ignore

// Example 03: Agent with MCP Servers
//
// This example demonstrates creating an agent with all three types of MCP servers:
//   1. Stdio server (subprocess-based, most common)
//   2. HTTP server (remote services)
//   3. Docker server (containerized)
//
// MCP (Model Context Protocol) servers provide tools and capabilities to agents.
// Each server type serves different deployment scenarios:
//   - Stdio: Local tools that run as subprocesses (e.g., npx packages)
//   - HTTP: Remote services with HTTP + SSE communication
//   - Docker: Containerized tools with volume mounts and networking
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skillref"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// =============================================================================
		// Stdio MCP Server (GitHub)
		// =============================================================================
		// Most common type - runs as subprocess with stdin/stdout communication.
		// Use for npm/npx packages, local CLIs, or any command-line tool.
		githubServer, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-github"},
			EnvPlaceholders: map[string]string{
				"GITHUB_TOKEN": "${GITHUB_TOKEN}",
			},
			WorkingDir: "/app/mcp-servers",
		})
		if err != nil {
			return fmt.Errorf("failed to create GitHub MCP server: %w", err)
		}
		// Enable specific tools (if not called, all tools are available)
		githubServer.EnableTools("create_issue", "list_repos", "create_pr")

		// =============================================================================
		// HTTP MCP Server (Remote API Service)
		// =============================================================================
		// Used for managed/remote MCP services accessible via HTTP + SSE.
		// Supports headers and query params for authentication and configuration.
		apiServer, err := mcpserver.HTTP(ctx, "api-service", &mcpserver.HTTPArgs{
			Url: "https://mcp.example.com/api",
			Headers: map[string]string{
				"Authorization": "Bearer ${API_TOKEN}",
				"X-API-Version": "v1",
			},
			QueryParams: map[string]string{
				"region":      "${AWS_REGION}",
				"environment": "production",
			},
			TimeoutSeconds: 60,
		})
		if err != nil {
			return fmt.Errorf("failed to create API MCP server: %w", err)
		}
		apiServer.EnableTools("search", "fetch", "analyze")

		// =============================================================================
		// Docker MCP Server (Containerized)
		// =============================================================================
		// Used for custom/isolated MCP servers with full container configuration:
		// - Volume mounts for data and config
		// - Port mappings for network access
		// - Custom networks for service discovery
		// - Environment variables for secrets
		customServer, err := mcpserver.Docker(ctx, "custom-mcp", &mcpserver.DockerArgs{
			Image: "ghcr.io/myorg/custom-mcp:latest",
			Args:  []string{"--config", "/etc/mcp/config.yaml", "--verbose"},
			EnvPlaceholders: map[string]string{
				"API_KEY":      "${CUSTOM_API_KEY}",
				"DATABASE_URL": "${DATABASE_URL}",
			},
			Volumes: []*types.VolumeMount{
				{HostPath: "/host/data", ContainerPath: "/mnt/data", ReadOnly: false},
				{HostPath: "/host/config", ContainerPath: "/etc/mcp", ReadOnly: true},
			},
			Ports: []*types.PortMapping{
				{HostPort: 8080, ContainerPort: 80, Protocol: "tcp"},
				{HostPort: 8443, ContainerPort: 443, Protocol: "tcp"},
			},
			Network:       "mcp-network",
			ContainerName: "my-custom-mcp",
		})
		if err != nil {
			return fmt.Errorf("failed to create custom Docker MCP server: %w", err)
		}
		customServer.EnableTools("process_data", "generate_report")

		// =============================================================================
		// Another Stdio Server (AWS CLI)
		// =============================================================================
		// Demonstrates multiple Stdio servers with different env var configurations.
		awsServer, err := mcpserver.Stdio(ctx, "aws", &mcpserver.StdioArgs{
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-aws"},
			EnvPlaceholders: map[string]string{
				"AWS_ACCESS_KEY_ID":     "${AWS_ACCESS_KEY_ID}",
				"AWS_SECRET_ACCESS_KEY": "${AWS_SECRET_ACCESS_KEY}",
				"AWS_REGION":            "${AWS_REGION}",
			},
		})
		if err != nil {
			return fmt.Errorf("failed to create AWS MCP server: %w", err)
		}
		// Note: No EnableTools() call means all tools are available

		// =============================================================================
		// Create Agent with MCP Servers
		// =============================================================================
		a, err := agent.New(ctx, "devops-agent", &agent.AgentArgs{
			Instructions: `You are a DevOps automation agent with access to multiple tools.

You have access to:
- GitHub (create issues, PRs, list repos)
- AWS services (via AWS CLI MCP)
- API service (search, fetch, analyze data)
- Custom MCP server (process data, generate reports)

Use these tools to help with infrastructure automation, deployments, and DevOps workflows.`,
			Description: "DevOps automation agent with GitHub, AWS, API, and custom MCP servers",
			IconUrl:     "https://example.com/devops-agent.png",
		})
		if err != nil {
			return fmt.Errorf("failed to create agent: %w", err)
		}

		// Add skill references (platform-scoped skills shared across the platform)
		a.AddSkillRefs(
			skillref.Platform("devops-best-practices"),
			skillref.Platform("cloud-infrastructure"),
		)

		// Add all MCP servers to the agent
		a.AddMCPServers(
			githubServer,
			apiServer,
			customServer,
			awsServer,
		)

		// =============================================================================
		// Display Agent Configuration
		// =============================================================================
		fmt.Println("=== Agent Configuration ===")
		fmt.Printf("Name: %s\n", a.Name)
		fmt.Printf("Instructions: %s\n", a.Instructions[:100]+"...")
		fmt.Printf("Skill Refs: %d\n", len(a.SkillRefs))
		fmt.Printf("MCP Servers: %d\n\n", len(a.MCPServers))

		// Display MCP servers
		fmt.Println("=== MCP Servers ===")
		for i, server := range a.MCPServers {
			fmt.Printf("%d. %s (%s)\n", i+1, server.Name(), server.Type())
			tools := server.EnabledTools()
			if len(tools) > 0 {
				fmt.Printf("   Enabled tools: %v\n", tools)
			} else {
				fmt.Println("   Enabled tools: all")
			}
		}

		fmt.Println("\n=== Summary ===")
		fmt.Println("Created agent with 4 MCP servers:")
		fmt.Println("  - Stdio servers: 2 (GitHub, AWS)")
		fmt.Println("  - HTTP servers: 1 (API service)")
		fmt.Println("  - Docker servers: 1 (Custom MCP)")
		fmt.Println()
		fmt.Println("All servers configured with:")
		fmt.Println("  - Environment variable placeholders (secrets injected at runtime)")
		fmt.Println("  - Enabled tool selections (or all tools if not specified)")
		fmt.Println("  - Type-specific configurations (volumes, ports, headers, etc.)")
		fmt.Println()
		fmt.Println("Note: Run `stigmer deploy` to deploy this agent to the platform.")

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
