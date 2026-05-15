package harness

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/google/uuid"
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
				Org:  testOrg,
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
				Org:  testOrg,
				Kind: 44,
			},
			EnabledTools:           enabledTools,
			ToolApprovalOverrides:  overrides,
		})
	}
}

// WithSkillRef adds a skill reference to the agent.
func WithSkillRef(slug string) AgentOption {
	return func(s *agentv1.AgentSpec) {
		s.SkillRefs = append(s.SkillRefs, &apiresource.ApiResourceReference{
			Slug: slug,
			Org:  testOrg,
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

// CreateAgent creates a test agent with the given instructions and options.
// The agent is auto-deleted on test cleanup.
func CreateAgent(t *testing.T, ctx context.Context, clients *Clients, name, instructions string, opts ...AgentOption) *agentv1.Agent {
	t.Helper()

	spec := &agentv1.AgentSpec{
		Description:  "Integration test agent: " + name,
		Instructions: instructions,
	}
	for _, opt := range opts {
		opt(spec)
	}

	agent := &agentv1.Agent{
		ApiVersion: testAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name + "-" + uuid.New().String()[:8],
			Org:  testOrg,
		},
		Spec: spec,
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
