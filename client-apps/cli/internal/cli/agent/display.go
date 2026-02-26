// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// displayAgentSummary displays a summary of Agent configuration fields.
// Internal helper for consistent formatting across display functions.
func displayAgentSummary(agent *agentv1.Agent) {
	cliprint.PrintInfo("  Name:         %s", agent.Metadata.Name)

	if agent.Spec != nil {
		if agent.Spec.Description != "" {
			cliprint.PrintInfo("  Description:  %s", agent.Spec.Description)
		}

		if agent.Spec.Instructions != "" {
			cliprint.PrintInfo("  Instructions: %s", truncateString(agent.Spec.Instructions, 80))
		}

		mcpCount := len(agent.Spec.McpServerUsages)
		if mcpCount > 0 {
			cliprint.PrintInfo("  MCP Servers:  %d", mcpCount)
		}

		skillCount := len(agent.Spec.SkillRefs)
		if skillCount > 0 {
			cliprint.PrintInfo("  Skills:       %d", skillCount)
		}

		subAgentCount := len(agent.Spec.SubAgents)
		if subAgentCount > 0 {
			cliprint.PrintInfo("  Sub-agents:   %d", subAgentCount)
		}
	}
}

// truncateString truncates a string to maxLen characters, adding "..." if truncated.
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return "..."
	}
	return s[:maxLen-3] + "..."
}

// DisplayGetResult displays an agent in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(agent *agentv1.Agent, format string) {
	display.DisplayProto(agent, format, func() { displayAgentTable(agent) })
}

// displayAgentTable displays the agent in human-readable table format.
func displayAgentTable(agent *agentv1.Agent) {
	fmt.Println()
	cliprint.PrintInfo("Agent: %s", agent.Metadata.Name)
	fmt.Println()

	cliprint.PrintInfo("Metadata:")
	cliprint.PrintInfo("  ID:          %s", agent.Metadata.Id)
	cliprint.PrintInfo("  Name:        %s", agent.Metadata.Name)
	cliprint.PrintInfo("  Slug:        %s", agent.Metadata.Slug)
	cliprint.PrintInfo("  Org:         %s", agent.Metadata.Org)
	fmt.Println()

	cliprint.PrintInfo("Spec:")
	displayAgentSummary(agent)
	fmt.Println()
}

// DisplayListResult displays a list of agents from search results.
// Uses the generic search display with agent-specific settings.
func DisplayListResult(results *search.Result, format string, page int32) {
	if results.IsEmpty() {
		search.DisplayEmptyResults("agents", "")
		return
	}

	search.DisplayResults(results, &search.DisplayOptions{
		Format:       format,
		ShowKind:     false, // Agent-specific: don't show KIND column
		ShowOrg:      true,  // Show ORG since agents can be from different orgs
		MaxDescLen:   50,
		ResourceName: "agents",
	})

	search.DisplayPaginationInfo(page, results.TotalPages, results.TotalCount)
}

// DisplaySearchResult displays agent search results with query context.
// Shows results sorted by relevance with the search query highlighted.
func DisplaySearchResult(results *search.Result, query string, format string, page int32) {
	if results.IsEmpty() {
		search.DisplayEmptyResults("agents", query)
		return
	}

	// For search results, show a header indicating what was searched
	if format == "table" || format == "" {
		fmt.Println()
		cliprint.PrintInfo("Found %d agents matching '%s'", results.TotalCount, query)
	}

	search.DisplayResults(results, &search.DisplayOptions{
		Format:       format,
		ShowKind:     false,
		ShowOrg:      true,
		MaxDescLen:   50,
		ResourceName: "agents",
	})

	search.DisplayPaginationInfo(page, results.TotalPages, results.TotalCount)
}
