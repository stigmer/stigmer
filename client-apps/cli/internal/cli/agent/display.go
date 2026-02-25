// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// DisplayApplyResult displays the result of an apply operation.
// Shows success message with resource details and next steps.
func DisplayApplyResult(result *ApplyResult) {
	fmt.Println()
	if result.Created {
		cliprint.PrintSuccess("Agent created successfully")
	} else {
		cliprint.PrintSuccess("Agent updated successfully")
	}

	fmt.Println()
	cliprint.PrintInfo("Resource Details:")
	cliprint.PrintInfo("  ID:   %s", result.Agent.Metadata.Id)
	cliprint.PrintInfo("  Name: %s", result.Agent.Metadata.Name)
	cliprint.PrintInfo("  Slug: %s", result.Agent.Metadata.Slug)

	fmt.Println()
	cliprint.PrintInfo("Next steps:")
	cliprint.PrintInfo("  - View details:  stigmer agent get %s", result.Agent.Metadata.Slug)
	cliprint.PrintInfo("  - Run agent:     stigmer agent run %s", result.Agent.Metadata.Slug)
	cliprint.PrintInfo("  - Delete:        stigmer agent delete %s", result.Agent.Metadata.Slug)
	fmt.Println()
}

// DisplayAgentPreview displays a preview of the Agent configuration.
// Used for dry-run mode to show what would be applied.
func DisplayAgentPreview(agent *agentv1.Agent) {
	fmt.Println()
	cliprint.PrintInfo("Agent Preview:")
	displayAgentSummary(agent)
	fmt.Println()
}

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
	switch format {
	case "yaml":
		displayAgentYAML(agent)
	case "json":
		displayAgentJSON(agent)
	default: // table
		displayAgentTable(agent)
	}
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

// displayAgentYAML displays the agent as YAML.
func displayAgentYAML(agent *agentv1.Agent) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(agent)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal agent to JSON: %w", err))
		return
	}

	// Convert JSON to YAML via generic map
	var jsonMap map[string]interface{}
	if err := yaml.Unmarshal(jsonBytes, &jsonMap); err != nil {
		clierr.Handle(fmt.Errorf("failed to parse JSON: %w", err))
		return
	}

	yamlBytes, err := yaml.Marshal(jsonMap)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal to YAML: %w", err))
		return
	}
	fmt.Print(string(yamlBytes))
}

// displayAgentJSON displays the agent as JSON.
func displayAgentJSON(agent *agentv1.Agent) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(agent)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal agent to JSON: %w", err))
		return
	}
	fmt.Println(string(jsonBytes))
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
