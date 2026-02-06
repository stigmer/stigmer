package agent

import (
	"fmt"

	"buf.build/go/protovalidate"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/commons/metadata"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
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
// All fields including SubAgents are used directly from Args.
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
		Annotations: metadata.SDKAnnotations(),
		Visibility:  apiresource.ApiResourceVisibility_visibility_private,
	}

	// Build spec from Args - single source of truth for configuration
	// All fields are already proto stub types, use them directly
	spec := &agentv1.AgentSpec{
		Description:     a.Args.Description,
		IconUrl:         a.Args.IconUrl,
		Instructions:    a.Args.Instructions,
		SkillRefs:       a.Args.SkillRefs,
		McpServerUsages: a.Args.McpServerUsages,
		SubAgents:       a.Args.SubAgents, // Direct from Args - single source of truth
		EnvSpec:         a.Args.EnvSpec,
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
