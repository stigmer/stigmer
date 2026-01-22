package agent

import (
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/subagent"
)

// ToProto converts the SDK Agent to a platform Agent proto message.
//
// This method creates a complete Agent proto with:
//   - API version and kind
//   - Metadata with SDK annotations
//   - Spec converted from SDK agent to proto AgentSpec
//
// Example:
//
//	agent, _ := agent.New(ctx,
//	    agent.WithName("code-reviewer"),
//	    agent.WithInstructions("Review code"),
//	)
//	proto, err := agent.ToProto()
func (a *Agent) ToProto() (*agentv1.Agent, error) {
	// Convert skills to skill references
	skillRefs, err := convertSkillsToRefs(a.Skills)
	if err != nil {
		return nil, fmt.Errorf("failed to convert skills: %w", err)
	}

	// Convert MCP servers
	mcpServers, err := convertMCPServers(a.MCPServers)
	if err != nil {
		return nil, fmt.Errorf("failed to convert MCP servers: %w", err)
	}

	// Convert sub-agents
	subAgents, err := convertSubAgents(a.SubAgents)
	if err != nil {
		return nil, fmt.Errorf("failed to convert sub-agents: %w", err)
	}

	// Convert environment variables
	envSpec, err := convertEnvironmentVariables(a.EnvironmentVariables)
	if err != nil {
		return nil, fmt.Errorf("failed to convert environment variables: %w", err)
	}

	// Build metadata
	metadata := &apiresource.ApiResourceMetadata{
		Name:        a.Name,
		Annotations: SDKAnnotations(),
	}

	// Build complete Agent proto
	return &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata:   metadata,
		Spec: &agentv1.AgentSpec{
			Description:  a.Description,
			IconUrl:      a.IconURL,
			Instructions: a.Instructions,
			SkillRefs:    skillRefs,
			McpServers:   mcpServers,
			SubAgents:    subAgents,
			EnvSpec:      envSpec,
		},
	}, nil
}

// convertSkillsToRefs converts SDK skills to API resource references.
func convertSkillsToRefs(skills []skill.Skill) ([]*apiresource.ApiResourceReference, error) {
	if len(skills) == 0 {
		return nil, nil
	}

	refs := make([]*apiresource.ApiResourceReference, 0, len(skills))
	for _, s := range skills {
		// For inline skills, use the name as the reference
		// For platform/org skills, use the slug
		name := s.NameOrSlug()

		// TODO: Determine correct OwnerScope based on skill type
		// - Inline skills: use agent's owner scope
		// - Platform skills: OwnerScope_PLATFORM
		// - Org skills: OwnerScope_ORGANIZATION

		ref := &apiresource.ApiResourceReference{
			Slug: name,
			// Kind: 43, // Skill kind enum value (from proto)
			// TODO: Set Scope and Org based on skill type
		}
		refs = append(refs, ref)
	}

	return refs, nil
}

// convertMCPServers converts SDK MCP servers to proto MCP server definitions.
func convertMCPServers(servers []mcpserver.MCPServer) ([]*agentv1.McpServerDefinition, error) {
	if len(servers) == 0 {
		return nil, nil
	}

	defs := make([]*agentv1.McpServerDefinition, 0, len(servers))
	for _, server := range servers {
		def := &agentv1.McpServerDefinition{
			Name:         server.Name(),
			EnabledTools: server.EnabledTools(),
		}

		// TODO: Convert server type-specific configuration
		// - TypeStdio → StdioServer
		// - TypeHTTP → HttpServer
		// - TypeDocker → DockerServer
		// This requires type assertions and detailed field mapping

		switch server.Type() {
		case mcpserver.TypeStdio:
			// TODO: Convert to StdioServer proto
			// def.ServerType = &agentv1.McpServerDefinition_Stdio{...}
		case mcpserver.TypeHTTP:
			// TODO: Convert to HttpServer proto
			// def.ServerType = &agentv1.McpServerDefinition_Http{...}
		case mcpserver.TypeDocker:
			// TODO: Convert to DockerServer proto
			// def.ServerType = &agentv1.McpServerDefinition_Docker{...}
		}

		defs = append(defs, def)
	}

	return defs, nil
}

// convertSubAgents converts SDK sub-agents to proto sub-agents.
func convertSubAgents(subAgents []subagent.SubAgent) ([]*agentv1.SubAgent, error) {
	if len(subAgents) == 0 {
		return nil, nil
	}

	// TODO: Implement sub-agent conversion
	// - Inline sub-agents → InlineSubAgentSpec
	// - Referenced sub-agents → ApiResourceReference
	// This requires:
	// 1. Checking sub-agent type (inline vs reference)
	// 2. Converting inline specs with all fields
	// 3. Creating resource references for referenced sub-agents

	return nil, fmt.Errorf("sub-agent conversion not yet implemented")
}

// convertEnvironmentVariables converts SDK environment variables to proto EnvironmentSpec.
func convertEnvironmentVariables(vars []environment.Variable) (*environmentv1.EnvironmentSpec, error) {
	if len(vars) == 0 {
		return nil, nil
	}

	// TODO: Implement environment variable conversion
	// SDK: []environment.Variable
	// Proto: EnvironmentSpec with repeated EnvironmentValue
	// Mapping:
	// - Variable.Name → EnvironmentValue.name
	// - Variable.IsSecret → EnvironmentValue.is_secret
	// - Variable.Description → EnvironmentValue.description
	// - Variable.DefaultValue → EnvironmentValue.default_value
	// - Variable.Required → EnvironmentValue.required

	return nil, fmt.Errorf("environment variable conversion not yet implemented")
}
