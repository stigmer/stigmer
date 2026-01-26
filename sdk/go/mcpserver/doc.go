// Package mcpserver provides types for configuring MCP (Model Context Protocol) servers
// in Stigmer agents.
//
// MCP servers enable agents to interact with external tools and services. This package
// supports three types of MCP servers:
//
//  1. Stdio servers - Run as subprocesses with stdin/stdout communication
//  2. HTTP servers - Connect to remote services via HTTP + Server-Sent Events
//  3. Docker servers - Run as containerized services
//
// Basic Usage (struct-args pattern):
//
//	// Stdio server (e.g., GitHub MCP)
//	github, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
//		Command: "npx",
//		Args:    []string{"-y", "@modelcontextprotocol/server-github"},
//		EnvPlaceholders: map[string]string{
//			"GITHUB_TOKEN": "${GITHUB_TOKEN}",
//		},
//	})
//
//	// HTTP server (remote MCP service)
//	api, err := mcpserver.HTTP(ctx, "api-service", &mcpserver.HTTPArgs{
//		Url: "https://mcp.example.com",
//		Headers: map[string]string{
//			"Authorization": "Bearer ${API_TOKEN}",
//		},
//	})
//
//	// Docker server (containerized MCP)
//	custom, err := mcpserver.Docker(ctx, "custom-mcp", &mcpserver.DockerArgs{
//		Image: "ghcr.io/org/mcp:latest",
//		EnvPlaceholders: map[string]string{
//			"API_KEY": "${API_KEY}",
//		},
//	})
package mcpserver
