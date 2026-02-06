// Package mcpserver provides the MCPServer entity for defining MCP servers in the SDK.
//
// This package is for DEFINING new MCP servers that will be synthesized and applied.
// For REFERENCING existing MCP servers, use the mcpserverref package instead.
//
// # Domain Concept
//
// mcpserver creates MCPServer entities - full resource definitions with configuration
// that are registered with a context and synthesized to the .stigmer/ output directory.
//
// # Creating MCP Servers
//
// Use Stdio() or HTTP() constructors to create MCP servers:
//
//	import (
//	    "github.com/stigmer/stigmer/sdk/go/mcpserver"
//	    "github.com/stigmer/stigmer/sdk/go/gen/types"
//	    "github.com/stigmer/stigmer/sdk/go/stigmer"
//	)
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    // Stdio-based MCP server (subprocess)
//	    _, err := mcpserver.Stdio(ctx, "github-mcp", &mcpserver.McpServerArgs{
//	        Description: "GitHub MCP server",
//	        Stdio: &types.StdioServerConfig{
//	            Command: "npx",
//	            Args:    []string{"-y", "@modelcontextprotocol/server-github"},
//	        },
//	    })
//	    if err != nil {
//	        return err
//	    }
//
//	    // HTTP-based MCP server (remote)
//	    _, err = mcpserver.HTTP(ctx, "external-api", &mcpserver.McpServerArgs{
//	        Description: "External API server",
//	        Http: &types.HttpServerConfig{
//	            Url: "https://mcp.example.com/v1",
//	        },
//	    })
//	    return err
//	})
//
// # Server Types
//
// MCP servers can be one of three types:
//   - Stdio: Runs as a subprocess, communicates via stdin/stdout (most common)
//   - HTTP: Remote server accessible via HTTP + Server-Sent Events
//   - Docker: Runs in a container (future support)
//
// # Referencing MCP Servers
//
// To reference existing MCP servers from agents, use the mcpserverref package:
//
//	import "github.com/stigmer/stigmer/sdk/go/mcpserverref"
//
//	reviewer.AddMcpServerUsage(mcpserverref.New("stigmer", "github"))
package mcpserver
