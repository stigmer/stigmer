// Package mcpserver provides CLI utilities for managing MCP server resources.
package mcpserver

import (
	"fmt"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// DisplayGetResult displays an MCP server in the specified format.
func DisplayGetResult(mcpServer *mcpserverv1.McpServer, format string) {
	display.DisplayProto(mcpServer, format, func() { displayAsTable(mcpServer) })
}

// displayAsTable outputs the MCP server in human-readable table format.
func displayAsTable(mcpServer *mcpserverv1.McpServer) {
	fmt.Println()
	cliprint.PrintInfo("MCP Server: %s", mcpServer.Metadata.Name)
	fmt.Println()

	cliprint.PrintInfo("Metadata:")
	cliprint.PrintInfo("  ID:          %s", mcpServer.Metadata.Id)
	cliprint.PrintInfo("  Name:        %s", mcpServer.Metadata.Name)
	cliprint.PrintInfo("  Slug:        %s", mcpServer.Metadata.Slug)
	cliprint.PrintInfo("  Org:         %s", mcpServer.Metadata.Org)
	fmt.Println()

	cliprint.PrintInfo("Spec:")
	if mcpServer.Spec.Description != "" {
		cliprint.PrintInfo("  Description: %s", mcpServer.Spec.Description)
	}

	displayServerType(mcpServer)

	if len(mcpServer.Spec.Tags) > 0 {
		cliprint.PrintInfo("  Tags:        %v", mcpServer.Spec.Tags)
	}

	if len(mcpServer.Spec.DefaultEnabledTools) > 0 {
		cliprint.PrintInfo("  Tools:       %v", mcpServer.Spec.DefaultEnabledTools)
	}

	fmt.Println()
}

// displayServerType displays the server type configuration.
func displayServerType(mcpServer *mcpserverv1.McpServer) {
	if stdio := mcpServer.Spec.GetStdio(); stdio != nil {
		cliprint.PrintInfo("  Type:        stdio")
		cliprint.PrintInfo("  Command:     %s", stdio.Command)
		if len(stdio.Args) > 0 {
			cliprint.PrintInfo("  Args:        %v", stdio.Args)
		}
		if stdio.WorkingDir != "" {
			cliprint.PrintInfo("  Working Dir: %s", stdio.WorkingDir)
		}
	} else if http := mcpServer.Spec.GetHttp(); http != nil {
		cliprint.PrintInfo("  Type:        http")
		cliprint.PrintInfo("  URL:         %s", http.Url)
		if http.TimeoutSeconds > 0 {
			cliprint.PrintInfo("  Timeout:     %ds", http.TimeoutSeconds)
		}
	}
}

