// Package mcpserverref provides helpers for creating references to McpServer resources.
//
// McpServers are first-class API resources that define MCP server configurations
// (stdio, HTTP, or Docker-based). Agents reference these resources rather than
// defining MCP servers inline.
//
// This package follows the same pattern as skillref for creating references.
//
// # Scopes
//
// McpServers support three scopes:
//   - Platform: Public/marketplace servers, visible to all users
//   - Organization: Private to org members
//   - Personal (identity_account): Private to the individual user
//
// # Usage with Agents
//
// Use these functions when adding MCP server usages to agents:
//
//	import (
//	    "github.com/stigmer/stigmer/sdk/go/agent"
//	    "github.com/stigmer/stigmer/sdk/go/mcpserverref"
//	)
//
//	a, _ := agent.New(ctx, "my-agent", &agent.AgentArgs{
//	    Instructions: "You are an assistant...",
//	})
//
//	// Add platform MCP server with specific tools enabled
//	a.AddMcpServerUsage(
//	    mcpserverref.Platform("github"),
//	    "create_issue", "list_repos", "create_pr",
//	)
//
//	// Add organization MCP server
//	a.AddMcpServerUsage(
//	    mcpserverref.Organization("acme-corp", "internal-tools"),
//	)
//
//	// Add personal MCP server
//	a.AddMcpServerUsage(
//	    mcpserverref.Personal("my-dev-tools"),
//	)
//
// # Note on McpServer Resource Creation
//
// This package only creates references to existing McpServer resources.
// McpServer resources themselves are created via:
//   - CLI: `stigmer mcpserver apply -f mcpserver.yaml`
//   - API: Using the McpServer command controller
//
// The SDK does not support creating McpServer resources directly.
package mcpserverref
