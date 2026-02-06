package agent

import (
	"fmt"

	"buf.build/go/protovalidate"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
	"github.com/stigmer/stigmer/sdk/go/subagent"
)

// validator is the global protovalidate validator instance.
var validator protovalidate.Validator

func init() {
	// Initialize validator once at package load time
	var err error
	validator, err = protovalidate.New()
	if err != nil {
		panic(fmt.Sprintf("failed to initialize protovalidate: %v", err))
	}
}

// ToProto converts the SDK Agent to a platform Agent proto message.
//
// This method creates a complete Agent proto with:
//   - API version and kind
//   - Metadata with SDK annotations
//   - Spec converted from SDK agent to proto AgentSpec
//
// The spec is built from Args (single source of truth for configuration).
// SubAgents and EnvironmentVariables are converted from SDK-specific types.
//
// Example:
//
//	agent, _ := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
//	    Instructions: "Review code",
//	})
//	agent.AddSkillRef(skillref.Platform("coding-best-practices"))
//	agent.AddMcpServerUsage(mcpserverref.Platform("github"), "create_pr")
//	proto, err := agent.ToProto()
func (a *Agent) ToProto() (*agentv1.Agent, error) {
	if a.Args == nil {
		return nil, fmt.Errorf("agent: Args is nil, cannot convert to proto")
	}

	// Convert sub-agents (SDK-specific types to proto)
	subAgents, err := convertSubAgents(a.SubAgents)
	if err != nil {
		return nil, fmt.Errorf("failed to convert sub-agents: %w", err)
	}

	// Convert environment variables (SDK-specific types to proto)
	envSpec, err := convertEnvironmentVariables(a.EnvironmentVariables)
	if err != nil {
		return nil, fmt.Errorf("failed to convert environment variables: %w", err)
	}

	// Auto-generate slug if empty
	slug := a.Slug
	if slug == "" {
		slug = naming.GenerateSlug(a.Name)
	}

	// Build metadata
	// Default to private visibility for SDK-created agents
	metadata := &apiresource.ApiResourceMetadata{
		Name:        a.Name,
		Slug:        slug,
		Annotations: SDKAnnotations(),
		Visibility:  apiresource.ApiResourceVisibility_visibility_private,
	}

	// Build spec from Args - single source of truth for configuration
	// Args fields are already proto stub types, use them directly
	spec := &agentv1.AgentSpec{
		Description:     a.Args.Description,
		IconUrl:         a.Args.IconUrl,
		Instructions:    a.Args.Instructions,
		SkillRefs:       a.Args.SkillRefs,
		McpServerUsages: a.Args.McpServerUsages,
		SubAgents:       subAgents,
		EnvSpec:         envSpec,
	}

	// Build complete Agent proto
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata:   metadata,
		Spec:       spec,
	}

	// Validate the proto message against buf.validate rules
	if err := validator.Validate(agent); err != nil {
		return nil, fmt.Errorf("agent validation failed: %w", err)
	}

	return agent, nil
}

// convertSubAgents converts SDK sub-agents to proto sub-agents.
// SubAgent now uses McpAccess for granting access to parent's MCP servers.
func convertSubAgents(subAgents []subagent.SubAgent) ([]*agentv1.SubAgent, error) {
	if len(subAgents) == 0 {
		return []*agentv1.SubAgent{}, nil
	}

	protoSubAgents := make([]*agentv1.SubAgent, 0, len(subAgents))
	for _, sa := range subAgents {
		// Convert McpAccess grants
		mcpAccess := make([]*agentv1.McpAccess, 0, len(sa.McpAccess()))
		for _, access := range sa.McpAccess() {
			mcpAccess = append(mcpAccess, &agentv1.McpAccess{
				McpServer:    access.McpServer,
				EnabledTools: access.EnabledTools,
			})
		}

		// SubAgent fields are directly on the proto message
		protoSubAgents = append(protoSubAgents, &agentv1.SubAgent{
			Name:         sa.Name(),
			Description:  sa.Description(),
			Instructions: sa.Instructions(),
			McpAccess:    mcpAccess,
			SkillRefs:    sa.SkillRefs(),
		})
	}

	return protoSubAgents, nil
}

// convertEnvironmentVariables converts SDK environment variables to proto EnvironmentSpec.
func convertEnvironmentVariables(vars []environment.Variable) (*environmentv1.EnvironmentSpec, error) {
	if len(vars) == 0 {
		return nil, nil
	}

	// Build environment data map
	envData := make(map[string]*environmentv1.EnvironmentValue)
	for _, v := range vars {
		envData[v.Name] = &environmentv1.EnvironmentValue{
			Value:       v.DefaultValue, // Use default value as the template value
			IsSecret:    v.IsSecret,
			Description: v.Description,
		}
	}

	return &environmentv1.EnvironmentSpec{
		Description: fmt.Sprintf("Environment variables for agent (%d variables)", len(vars)),
		Data:        envData,
	}, nil
}
