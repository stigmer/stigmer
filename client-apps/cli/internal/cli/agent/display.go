// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
	"fmt"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
)

// displayAgentSummary displays a summary of Agent configuration fields.
// Internal helper for consistent formatting across display functions.
func displayAgentSummary(agent *agentv1.Agent) {
	fmt.Printf("  Name:         %s\n", agent.Metadata.Name)

	if agent.Spec != nil {
		if agent.Spec.Description != "" {
			fmt.Printf("  Description:  %s\n", agent.Spec.Description)
		}

		if agent.Spec.Instructions != "" {
			fmt.Printf("  Instructions: %s\n", display.TruncateWithEllipsis(agent.Spec.Instructions, 80))
		}

		mcpCount := len(agent.Spec.McpServerUsages)
		if mcpCount > 0 {
			fmt.Printf("  MCP Servers:  %d\n", mcpCount)
		}

		skillCount := len(agent.Spec.SkillRefs)
		if skillCount > 0 {
			fmt.Printf("  Skills:       %d\n", skillCount)
		}

		subAgentCount := len(agent.Spec.SubAgents)
		if subAgentCount > 0 {
			fmt.Printf("  Sub-agents:   %d\n", subAgentCount)
		}
	}
}

// DisplayGetResult displays an agent in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(agent *agentv1.Agent, format string) {
	display.DisplayProto(agent, format, func() { displayAgentTable(agent) })
}

// displayAgentTable displays the agent in human-readable table format.
func displayAgentTable(agent *agentv1.Agent) {
	fmt.Println()
	fmt.Printf("Agent: %s\n", agent.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:          %s\n", agent.Metadata.Id)
	fmt.Printf("  Name:        %s\n", agent.Metadata.Name)
	fmt.Printf("  Slug:        %s\n", agent.Metadata.Slug)
	fmt.Printf("  Org:         %s\n", agent.Metadata.Org)
	fmt.Println()

	fmt.Printf("Spec:\n")
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
		fmt.Printf("Found %d agents matching '%s'\n", results.TotalCount, query)
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
