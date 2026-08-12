package harness

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/require"
)

// AgentOption configures an AgentSpec before creation.
type AgentOption func(*agentv1.AgentSpec)

// WithMcpServerUsage adds an MCP server usage to the agent.
func WithMcpServerUsage(slug string, enabledTools ...string) AgentOption {
	return func(s *agentv1.AgentSpec) {
		s.McpServerUsages = append(s.McpServerUsages, &agentv1.McpServerUsage{
			McpServerRef: &apiresource.ApiResourceReference{
				Slug: slug,
				Org:  TestOrg,
				Kind: 44, // mcp_server
			},
			EnabledTools: enabledTools,
		})
	}
}

// WithMcpServerUsageAndApproval adds an MCP server usage with tool approval overrides.
func WithMcpServerUsageAndApproval(slug string, overrides []*agentv1.ToolApprovalOverride, enabledTools ...string) AgentOption {
	return func(s *agentv1.AgentSpec) {
		s.McpServerUsages = append(s.McpServerUsages, &agentv1.McpServerUsage{
			McpServerRef: &apiresource.ApiResourceReference{
				Slug: slug,
				Org:  TestOrg,
				Kind: 44,
			},
			EnabledTools:          enabledTools,
			ToolApprovalOverrides: overrides,
		})
	}
}


// WithSkillRef adds a skill reference to the agent.
func WithSkillRef(slug string) AgentOption {
	return func(s *agentv1.AgentSpec) {
		s.SkillRefs = append(s.SkillRefs, &apiresource.ApiResourceReference{
			Slug: slug,
			Org:  TestOrg,
			Kind: 43, // skill
		})
	}
}

// WithSubAgent adds a sub-agent definition.
func WithSubAgent(subAgent *agentv1.SubAgent) AgentOption {
	return func(s *agentv1.AgentSpec) {
		s.SubAgents = append(s.SubAgents, subAgent)
	}
}

// AgentCreateOption applies to the full Agent resource (metadata + spec).
// Use these alongside AgentOption in CreateAgent.
type AgentCreateOption func(*agentv1.Agent)

// WithAgentOrg overrides the org on the agent metadata (defaults to TestOrg).
func WithAgentOrg(org string) AgentCreateOption {
	return func(a *agentv1.Agent) {
		a.Metadata.Org = org
	}
}

// WithDefaultAgentLabel marks the agent as the platform default by setting the
// stigmer.ai/default-agent label and public visibility. The server resolves
// this agent when an execution is created without session_id or agent_id.
func WithDefaultAgentLabel() AgentCreateOption {
	return func(a *agentv1.Agent) {
		if a.Metadata.Labels == nil {
			a.Metadata.Labels = make(map[string]string)
		}
		a.Metadata.Labels["stigmer.ai/default-agent"] = "true"
		a.Metadata.Visibility = apiresource.ApiResourceVisibility_visibility_public
	}
}

// CreateAgent creates a test agent with the given instructions and options.
// The agent is auto-deleted on test cleanup.
func CreateAgent(t *testing.T, ctx context.Context, clients *Clients, name, instructions string, opts ...AgentOption) *agentv1.Agent {
	t.Helper()
	return createAgentInternal(t, ctx, clients, name, instructions, opts, nil)
}

// CreateAgentFull creates a test agent with both spec-level and agent-level options.
func CreateAgentFull(t *testing.T, ctx context.Context, clients *Clients, name, instructions string, specOpts []AgentOption, createOpts []AgentCreateOption) *agentv1.Agent {
	t.Helper()
	return createAgentInternal(t, ctx, clients, name, instructions, specOpts, createOpts)
}

func createAgentInternal(t *testing.T, ctx context.Context, clients *Clients, name, instructions string, specOpts []AgentOption, createOpts []AgentCreateOption) *agentv1.Agent {
	t.Helper()

	spec := &agentv1.AgentSpec{
		Description:  "Integration test agent: " + name,
		Instructions: instructions,
	}
	for _, opt := range specOpts {
		opt(spec)
	}

	agent := &agentv1.Agent{
		ApiVersion: TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name + "-" + uuid.New().String()[:8],
			Org:  TestOrg,
		},
		Spec: spec,
	}
	for _, opt := range createOpts {
		opt(agent)
	}

	created, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err, "apply agent %q should succeed", name)
	require.NotEmpty(t, created.GetMetadata().GetId(), "agent should have an ID")

	t.Logf("created agent: name=%s, id=%s, slug=%s",
		created.GetMetadata().GetName(),
		created.GetMetadata().GetId(),
		created.GetMetadata().GetSlug())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Logf("warning: failed to clean up agent %s: %v", name, err)
		}
	})

	return created
}
