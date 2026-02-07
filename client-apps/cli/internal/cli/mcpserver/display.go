// Package mcpserver provides CLI utilities for managing MCP server resources.
package mcpserver

import (
	"fmt"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// DisplayGetResult displays an MCP server in the specified format.
func DisplayGetResult(mcpServer *mcpserverv1.McpServer, format string) {
	switch format {
	case "yaml":
		displayAsYAML(mcpServer)
	case "json":
		displayAsJSON(mcpServer)
	default:
		displayAsTable(mcpServer)
	}
}

// displayAsYAML outputs the MCP server as YAML.
func displayAsYAML(mcpServer *mcpserverv1.McpServer) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(mcpServer)
	if err != nil {
		cliprint.PrintError("failed to marshal to JSON: %v", err)
		return
	}

	var jsonMap map[string]interface{}
	if err := yaml.Unmarshal(jsonBytes, &jsonMap); err != nil {
		cliprint.PrintError("failed to parse JSON: %v", err)
		return
	}

	yamlBytes, err := yaml.Marshal(jsonMap)
	if err != nil {
		cliprint.PrintError("failed to marshal to YAML: %v", err)
		return
	}
	fmt.Print(string(yamlBytes))
}

// displayAsJSON outputs the MCP server as JSON.
func displayAsJSON(mcpServer *mcpserverv1.McpServer) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(mcpServer)
	if err != nil {
		cliprint.PrintError("failed to marshal to JSON: %v", err)
		return
	}
	fmt.Println(string(jsonBytes))
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

// DisplayDeleteResult displays the result of a delete operation.
func DisplayDeleteResult(result *DeleteResult) {
	fmt.Println()
	cliprint.PrintSuccess("MCP server deleted successfully")
	fmt.Println()

	cliprint.PrintInfo("Deleted Resource:")
	cliprint.PrintInfo("  ID:   %s", result.McpServer.Metadata.Id)
	cliprint.PrintInfo("  Name: %s", result.McpServer.Metadata.Name)
	cliprint.PrintInfo("  Slug: %s", result.McpServer.Metadata.Slug)
	fmt.Println()
}

// DisplayDeleteConfirmation displays the MCP server details before deletion.
func DisplayDeleteConfirmation(mcpServer *mcpserverv1.McpServer) {
	fmt.Println()
	cliprint.PrintWarning("You are about to delete the following MCP server:")
	fmt.Println()
	cliprint.PrintInfo("  ID:   %s", mcpServer.Metadata.Id)
	cliprint.PrintInfo("  Name: %s", mcpServer.Metadata.Name)
	cliprint.PrintInfo("  Slug: %s", mcpServer.Metadata.Slug)
	cliprint.PrintInfo("  Org:  %s", mcpServer.Metadata.Org)
	fmt.Println()
	cliprint.PrintWarning("This action cannot be undone.")
	fmt.Println()
}

// DisplayMcpServerPreview displays a preview of the MCP server configuration.
func DisplayMcpServerPreview(mcpServer *mcpserverv1.McpServer) {
	fmt.Println()
	cliprint.PrintInfo("MCP Server Preview:")
	cliprint.PrintInfo("  Name:        %s", mcpServer.Metadata.Name)

	if mcpServer.Spec.Description != "" {
		cliprint.PrintInfo("  Description: %s", mcpServer.Spec.Description)
	}

	displayServerType(mcpServer)

	if len(mcpServer.Spec.Tags) > 0 {
		cliprint.PrintInfo("  Tags:        %v", mcpServer.Spec.Tags)
	}

	fmt.Println()
}
