package agents

import (
	"strings"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

const (
	agentAPIVersion = "agentic.stigmer.ai/v1"
	agentKind       = "Agent"
)

// toProto converts the flat, LLM-friendly ApplyAgentInput into a fully-formed
// Agent proto message ready for the gRPC Apply RPC.
//
// This is the MCP equivalent of sdk/go/agent.Agent.ToProto(). It handles:
//   - Wrapping identity fields into ApiResourceMetadata
//   - Wrapping spec fields into AgentSpec
//   - Setting api_version and kind constants
//   - Auto-generating slug from name when omitted
//   - Defaulting visibility to PRIVATE
//   - Auto-populating resource reference kinds (skill=43, mcp_server=44)
func (input *ApplyAgentInput) toProto() *agentv1.Agent {
	slug := input.Slug
	if slug == "" {
		slug = generateSlug(input.Name)
	}

	visibility := apiresource.ApiResourceVisibility_visibility_private
	if strings.EqualFold(input.Visibility, "PUBLIC") {
		visibility = apiresource.ApiResourceVisibility_visibility_public
	}

	return &agentv1.Agent{
		ApiVersion: agentAPIVersion,
		Kind:       agentKind,
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       input.Name,
			Slug:       slug,
			Org:        input.Org,
			Visibility: visibility,
			Labels:     input.Labels,
			Tags:       input.Tags,
		},
		Spec: buildAgentSpec(input),
	}
}

func buildAgentSpec(input *ApplyAgentInput) *agentv1.AgentSpec {
	spec := &agentv1.AgentSpec{
		Description:  input.Description,
		IconUrl:      input.IconUrl,
		Instructions: input.Instructions,
	}

	for _, u := range input.McpServerUsages {
		spec.McpServerUsages = append(spec.McpServerUsages, convertMcpServerUsage(u))
	}

	for _, s := range input.SkillRefs {
		spec.SkillRefs = append(spec.SkillRefs, convertSkillRef(s))
	}

	for _, sa := range input.SubAgents {
		spec.SubAgents = append(spec.SubAgents, convertSubAgent(sa))
	}

	if input.EnvSpec != nil {
		spec.EnvSpec = convertEnvironment(input.EnvSpec)
	}

	return spec
}

func convertMcpServerUsage(u McpServerUsageInput) *agentv1.McpServerUsage {
	usage := &agentv1.McpServerUsage{
		McpServerRef: &apiresource.ApiResourceReference{
			Org:  u.McpServerRef.Org,
			Slug: u.McpServerRef.Slug,
			Kind: apiresourcekind.ApiResourceKind_mcp_server,
		},
		EnabledTools: u.EnabledTools,
	}

	for _, o := range u.ToolApprovalOverrides {
		usage.ToolApprovalOverrides = append(usage.ToolApprovalOverrides, &agentv1.ToolApprovalOverride{
			ToolName:         o.ToolName,
			RequiresApproval: o.RequiresApproval,
			Message:          o.Message,
		})
	}

	return usage
}

func convertSkillRef(s SkillRefInput) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:     s.Org,
		Slug:    s.Slug,
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Version: s.Version,
	}
}

func convertSubAgent(sa SubAgentInput) *agentv1.SubAgent {
	sub := &agentv1.SubAgent{
		Name:         sa.Name,
		Description:  sa.Description,
		Instructions: sa.Instructions,
	}

	for _, a := range sa.McpAccess {
		sub.McpAccess = append(sub.McpAccess, &agentv1.McpAccess{
			McpServer:    a.McpServer,
			EnabledTools: a.EnabledTools,
		})
	}

	for _, s := range sa.SkillRefs {
		sub.SkillRefs = append(sub.SkillRefs, convertSkillRef(s))
	}

	return sub
}

func convertEnvironment(env *EnvironmentInput) *environmentv1.EnvironmentSpec {
	spec := &environmentv1.EnvironmentSpec{
		Description: env.Description,
	}

	if len(env.Data) > 0 {
		spec.Data = make(map[string]*environmentv1.EnvironmentValue, len(env.Data))
		for k, v := range env.Data {
			spec.Data[k] = &environmentv1.EnvironmentValue{
				Value:       v.Value,
				IsSecret:    v.IsSecret,
				Description: v.Description,
			}
		}
	}

	return spec
}

// generateSlug converts a name to a URL-friendly slug.
// Matches the convention used by the backend and sdk/go/stigmer/naming.
func generateSlug(name string) string {
	if name == "" {
		return ""
	}

	var b strings.Builder
	b.Grow(len(name))
	lastHyphen := false
	for _, r := range strings.ToLower(name) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastHyphen = false
		default:
			if !lastHyphen {
				b.WriteRune('-')
				lastHyphen = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}
