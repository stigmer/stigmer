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
// Basic Usage:
//
//	// Stdio server (e.g., GitHub MCP)
//	github := mcpserver.Stdio(
//		mcpserver.WithName("github"),
//		mcpserver.WithCommand("npx"),
//		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
//		mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
//	)
//
//	// HTTP server (remote MCP service)
//	api := mcpserver.HTTP(
//		mcpserver.WithName("api-service"),
//		mcpserver.WithURL("https://mcp.example.com"),
//		mcpserver.WithHeader("Authorization", "Bearer ${API_TOKEN}"),
//	)
//
//	// Docker server (containerized MCP)
//	custom := mcpserver.Docker(
//		mcpserver.WithName("custom-mcp"),
//		mcpserver.WithImage("ghcr.io/org/mcp:latest"),
//		mcpserver.WithEnvPlaceholder("API_KEY", "${API_KEY}"),
//	)
package mcpserver
