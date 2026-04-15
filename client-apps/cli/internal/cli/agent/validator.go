// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
	"fmt"

	"github.com/pkg/errors"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
)

// Validate performs cross-field business logic validation on an Agent.
//
// Schema validation (apiVersion, kind, metadata, instructions, reference kinds)
// is handled by protovalidate in Load(). This function validates relationships
// between fields that cannot be expressed in proto validation rules:
//
//   - SubAgent.mcp_access must reference parent's mcp_server_usages
//   - SubAgent.mcp_access.enabled_tools must be subset of parent's enabled_tools
//   - mcp_server_usages must have unique mcp_server_ref.slug values
//
// Returns nil if the agent passes all cross-field validations.
func Validate(agent *agentv1.Agent) error {
	if agent == nil || agent.Spec == nil {
		return nil // Schema validation handles required fields
	}

	if err := validateUniqueMcpServerUsages(agent.Spec); err != nil {
		return err
	}

	if err := validateSubAgentMcpAccess(agent.Spec); err != nil {
		return err
	}

	return nil
}

// validateUniqueMcpServerUsages ensures no duplicate mcp_server_ref.slug values
// in the agent's mcp_server_usages list.
func validateUniqueMcpServerUsages(spec *agentv1.AgentSpec) error {
	seen := make(map[string]bool)

	for i, usage := range spec.GetMcpServerUsages() {
		if usage == nil || usage.GetMcpServerRef() == nil {
			continue // Proto validation handles required fields
		}

		slug := usage.GetMcpServerRef().GetSlug()
		if slug == "" {
			continue // Proto validation handles required slug
		}

		if seen[slug] {
			return fmt.Errorf(
				"duplicate MCP server reference at mcp_server_usages[%d]: slug %q is already used\n\n"+
					"Each MCP server can only be referenced once. Remove the duplicate entry.",
				i, slug,
			)
		}
		seen[slug] = true
	}

	return nil
}

// validateSubAgentMcpAccess ensures each SubAgent's mcp_access references
// only MCP servers declared in the parent's mcp_server_usages.
func validateSubAgentMcpAccess(spec *agentv1.AgentSpec) error {
	// Build set of available MCP server slugs from parent
	parentMcpServers := buildParentMcpServerMap(spec)

	// Validate each sub-agent's mcp_access
	for i, subAgent := range spec.GetSubAgents() {
		if subAgent == nil {
			continue
		}

		if err := validateSubAgentMcpAccessItems(subAgent, i, parentMcpServers); err != nil {
			return err
		}
	}

	return nil
}

// buildParentMcpServerMap creates a map of slug -> enabled_tools for parent's MCP servers.
func buildParentMcpServerMap(spec *agentv1.AgentSpec) map[string][]string {
	result := make(map[string][]string)

	for _, usage := range spec.GetMcpServerUsages() {
		if usage == nil || usage.GetMcpServerRef() == nil {
			continue
		}

		slug := usage.GetMcpServerRef().GetSlug()
		if slug != "" {
			result[slug] = usage.GetEnabledTools()
		}
	}

	return result
}

// validateSubAgentMcpAccessItems validates a single sub-agent's mcp_access list.
func validateSubAgentMcpAccessItems(
	subAgent *agentv1.SubAgent,
	subAgentIndex int,
	parentMcpServers map[string][]string,
) error {
	subAgentName := subAgent.GetName()
	if subAgentName == "" {
		subAgentName = fmt.Sprintf("sub_agents[%d]", subAgentIndex)
	}

	for j, access := range subAgent.GetMcpAccess() {
		if access == nil {
			continue
		}

		mcpServer := access.GetMcpServer()
		if mcpServer == "" {
			continue // Proto validation handles required field
		}

		// Check if the MCP server is declared in parent
		parentTools, exists := parentMcpServers[mcpServer]
		if !exists {
			return errors.Errorf(
				"sub-agent %q references undefined MCP server %q at mcp_access[%d]\n\n"+
					"The MCP server must be declared in the parent agent's mcp_server_usages.\n"+
					"Add an mcp_server_usages entry with mcp_server_ref.slug: %q",
				subAgentName, mcpServer, j, mcpServer,
			)
		}

		// Validate enabled_tools is subset of parent's tools
		if err := validateToolsSubset(subAgentName, mcpServer, access.GetEnabledTools(), parentTools); err != nil {
			return err
		}
	}

	return nil
}

// validateToolsSubset ensures sub-agent's tools are a subset of parent's tools.
// Empty parent tools means "all tools" (no restriction from parent).
// Empty sub-agent tools means "all tools from parent" (no additional restriction).
func validateToolsSubset(subAgentName, mcpServer string, subAgentTools, parentTools []string) error {
	// If parent has no restrictions, sub-agent can use anything
	if len(parentTools) == 0 {
		return nil
	}

	// If sub-agent has no restrictions, it inherits parent's tools
	if len(subAgentTools) == 0 {
		return nil
	}

	// Build set of parent tools for O(1) lookup
	parentToolSet := make(map[string]bool, len(parentTools))
	for _, tool := range parentTools {
		parentToolSet[tool] = true
	}

	// Check each sub-agent tool is in parent's set
	for _, tool := range subAgentTools {
		if !parentToolSet[tool] {
			return errors.Errorf(
				"sub-agent %q requests tool %q from MCP server %q that is not enabled for the parent agent\n\n"+
					"Sub-agents can only use tools that are enabled for the parent.\n"+
					"Either add %q to the parent's enabled_tools for %q, or remove it from the sub-agent.",
				subAgentName, tool, mcpServer, tool, mcpServer,
			)
		}
	}

	return nil
}
