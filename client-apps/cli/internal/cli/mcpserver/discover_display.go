package mcpserver

import (
	"fmt"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
)

// DisplayDiscoverResult prints the discovery outcome to the terminal.
func DisplayDiscoverResult(result *DiscoverResult) {
	fmt.Println()
	cliprint.PrintInfo("MCP Server: %s/%s", result.McpServer.Metadata.Org, result.McpServer.Metadata.Name)
	displayTransportType(result.McpServer)
	fmt.Println()

	displayDiscoveredTools(result.Capabilities.Tools)
	displayDiscoveredResourceTemplates(result.Capabilities.ResourceTemplates)

	if result.Updated != nil {
		cliprint.PrintSuccess("Capabilities pushed to stigmer-server")
	} else {
		cliprint.PrintWarning("Dry run — results not pushed to backend")
	}
	fmt.Println()
}

func displayTransportType(server *mcpserverv1.McpServer) {
	if stdio := server.Spec.GetStdio(); stdio != nil {
		cliprint.PrintInfo("Transport:  stdio (%s)", stdio.Command)
	} else if h := server.Spec.GetHttp(); h != nil {
		cliprint.PrintInfo("Transport:  http (%s)", h.Url)
	}
}

func displayDiscoveredTools(tools []*mcpserverv1.DiscoveredTool) {
	cliprint.PrintInfo("Tools (%d):", len(tools))
	if len(tools) == 0 {
		cliprint.PrintInfo("  (none)")
		fmt.Println()
		return
	}
	for _, t := range tools {
		if t.Description != "" {
			cliprint.PrintInfo("  %-30s %s", t.Name, t.Description)
		} else {
			cliprint.PrintInfo("  %s", t.Name)
		}
	}
	fmt.Println()
}

func displayDiscoveredResourceTemplates(templates []*mcpserverv1.DiscoveredResourceTemplate) {
	cliprint.PrintInfo("Resource Templates (%d):", len(templates))
	if len(templates) == 0 {
		cliprint.PrintInfo("  (none)")
		fmt.Println()
		return
	}
	for _, t := range templates {
		cliprint.PrintInfo("  %-30s %s", t.Name, t.UriTemplate)
	}
	fmt.Println()
}
