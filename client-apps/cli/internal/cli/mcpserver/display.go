// Package mcpserver provides CLI utilities for managing MCP server resources.
package mcpserver

import (
	"fmt"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
)

// DisplayGetResult displays an MCP server in the specified format.
func DisplayGetResult(mcpServer *mcpserverv1.McpServer, format string) {
	display.DisplayProto(mcpServer, format, func() { displayAsTable(mcpServer) })
}

// displayAsTable outputs the MCP server in human-readable table format.
func displayAsTable(mcpServer *mcpserverv1.McpServer) {
	fmt.Println()
	fmt.Printf("MCP Server: %s\n", mcpServer.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:          %s\n", mcpServer.Metadata.Id)
	fmt.Printf("  Name:        %s\n", mcpServer.Metadata.Name)
	fmt.Printf("  Slug:        %s\n", mcpServer.Metadata.Slug)
	fmt.Printf("  Org:         %s\n", mcpServer.Metadata.Org)
	fmt.Println()

	fmt.Printf("Spec:\n")
	if mcpServer.Spec.Description != "" {
		fmt.Printf("  Description: %s\n", mcpServer.Spec.Description)
	}

	displayServerType(mcpServer)

	if len(mcpServer.Spec.Tags) > 0 {
		fmt.Printf("  Tags:        %v\n", mcpServer.Spec.Tags)
	}

	if len(mcpServer.Spec.DefaultEnabledTools) > 0 {
		fmt.Printf("  Tools:       %v\n", mcpServer.Spec.DefaultEnabledTools)
	}

	fmt.Println()
}

// displayServerType displays the server type configuration.
func displayServerType(mcpServer *mcpserverv1.McpServer) {
	if stdio := mcpServer.Spec.GetStdio(); stdio != nil {
		fmt.Printf("  Type:        stdio\n")
		fmt.Printf("  Command:     %s\n", stdio.Command)
		if len(stdio.Args) > 0 {
			fmt.Printf("  Args:        %v\n", stdio.Args)
		}
		if stdio.WorkingDir != "" {
			fmt.Printf("  Working Dir: %s\n", stdio.WorkingDir)
		}
	} else if http := mcpServer.Spec.GetHttp(); http != nil {
		fmt.Printf("  Type:        http\n")
		fmt.Printf("  URL:         %s\n", http.Url)
		if http.TimeoutSeconds > 0 {
			fmt.Printf("  Timeout:     %ds\n", http.TimeoutSeconds)
		}
	}
}
