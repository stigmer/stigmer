// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
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
