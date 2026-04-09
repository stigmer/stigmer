package mcpserver

import (
	"fmt"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// DisplayDiscoverResult prints the discovery outcome to the terminal.
func DisplayDiscoverResult(result *DiscoverResult) {
	fmt.Println()
	climsg.Info("MCP Server: %s/%s", result.McpServer.Metadata.Org, result.McpServer.Metadata.Name)
	displayTransportType(result.McpServer)
	fmt.Println()

	displayDiscoveredTools(result.Capabilities.Tools)
	displayDiscoveredResourceTemplates(result.Capabilities.ResourceTemplates)

	if result.Updated != nil {
		climsg.Success("Connected — capabilities and tool approvals saved")
	} else {
		climsg.Warning("Dry run — results not saved to backend")
	}
	fmt.Println()
}

func displayTransportType(server *mcpserverv1.McpServer) {
	if stdio := server.Spec.GetStdio(); stdio != nil {
		climsg.Info("Transport:  stdio (%s)", stdio.Command)
	} else if h := server.Spec.GetHttp(); h != nil {
		climsg.Info("Transport:  http (%s)", h.Url)
	}
}

func displayDiscoveredTools(tools []*mcpserverv1.DiscoveredTool) {
	climsg.Info("Tools (%d):", len(tools))
	if len(tools) == 0 {
		climsg.Info("  (none)")
		fmt.Println()
		return
	}
	for _, t := range tools {
		if t.Description != "" {
			climsg.Info("  %-30s %s", t.Name, t.Description)
		} else {
			climsg.Info("  %s", t.Name)
		}
	}
	fmt.Println()
}

func displayDiscoveredResourceTemplates(templates []*mcpserverv1.DiscoveredResourceTemplate) {
	climsg.Info("Resource Templates (%d):", len(templates))
	if len(templates) == 0 {
		climsg.Info("  (none)")
		fmt.Println()
		return
	}
	for _, t := range templates {
		climsg.Info("  %-30s %s", t.Name, t.UriTemplate)
	}
	fmt.Println()
}
