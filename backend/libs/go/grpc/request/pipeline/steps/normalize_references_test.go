package steps

import (
	"context"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

func TestNormalizeReferencesStep_Name(t *testing.T) {
	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	if step.Name() != "NormalizeReferences" {
		t.Errorf("Expected Name()=NormalizeReferences, got %q", step.Name())
	}
}

func TestNormalizeReferencesStep_EmptyOrgFilled(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			SkillRefs: []*apiresource.ApiResourceReference{
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "web-search"},
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "code-review"},
			},
		},
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for i, ref := range agent.Spec.SkillRefs {
		if ref.Org != "acme" {
			t.Errorf("skill_refs[%d].org = %q, want %q", i, ref.Org, "acme")
		}
	}
}

func TestNormalizeReferencesStep_ExplicitOrgPreserved(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			SkillRefs: []*apiresource.ApiResourceReference{
				{Org: "marketplace", Kind: apiresourcekind.ApiResourceKind_skill, Slug: "premium-skill"},
			},
		},
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if agent.Spec.SkillRefs[0].Org != "marketplace" {
		t.Errorf("explicit org was overwritten: got %q, want %q", agent.Spec.SkillRefs[0].Org, "marketplace")
	}
}

func TestNormalizeReferencesStep_MixedOrgs(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			SkillRefs: []*apiresource.ApiResourceReference{
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "local-skill"},
				{Org: "marketplace", Kind: apiresourcekind.ApiResourceKind_skill, Slug: "premium-skill"},
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "another-local"},
			},
		},
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectations := []string{"acme", "marketplace", "acme"}
	for i, ref := range agent.Spec.SkillRefs {
		if ref.Org != expectations[i] {
			t.Errorf("skill_refs[%d].org = %q, want %q", i, ref.Org, expectations[i])
		}
	}
}

func TestNormalizeReferencesStep_McpServerUsageRef(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "github",
					},
				},
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Org:  "partner",
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "external-tool",
					},
				},
			},
		},
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if agent.Spec.McpServerUsages[0].McpServerRef.Org != "acme" {
		t.Errorf("mcp_server_usages[0].mcp_server_ref.org = %q, want %q",
			agent.Spec.McpServerUsages[0].McpServerRef.Org, "acme")
	}
	if agent.Spec.McpServerUsages[1].McpServerRef.Org != "partner" {
		t.Errorf("mcp_server_usages[1].mcp_server_ref.org = %q, want %q",
			agent.Spec.McpServerUsages[1].McpServerRef.Org, "partner")
	}
}

func TestNormalizeReferencesStep_NestedSubAgentSkillRefs(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			SubAgents: []*agentv1.SubAgent{
				{
					Name:         "reviewer",
					Instructions: "You review code",
					SkillRefs: []*apiresource.ApiResourceReference{
						{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "code-review"},
						{Org: "marketplace", Kind: apiresourcekind.ApiResourceKind_skill, Slug: "premium"},
					},
				},
				{
					Name:         "writer",
					Instructions: "You write documentation",
					SkillRefs: []*apiresource.ApiResourceReference{
						{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "docs-writing"},
					},
				},
			},
		},
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	sub0 := agent.Spec.SubAgents[0]
	if sub0.SkillRefs[0].Org != "acme" {
		t.Errorf("sub_agents[0].skill_refs[0].org = %q, want %q", sub0.SkillRefs[0].Org, "acme")
	}
	if sub0.SkillRefs[1].Org != "marketplace" {
		t.Errorf("sub_agents[0].skill_refs[1].org = %q, want %q", sub0.SkillRefs[1].Org, "marketplace")
	}

	sub1 := agent.Spec.SubAgents[1]
	if sub1.SkillRefs[0].Org != "acme" {
		t.Errorf("sub_agents[1].skill_refs[0].org = %q, want %q", sub1.SkillRefs[0].Org, "acme")
	}
}

func TestNormalizeReferencesStep_AllRefsAtOnce(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			SkillRefs: []*apiresource.ApiResourceReference{
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "skill-a"},
			},
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "github",
					},
				},
			},
			SubAgents: []*agentv1.SubAgent{
				{
					Name:         "helper",
					Instructions: "You help with tasks",
					SkillRefs: []*apiresource.ApiResourceReference{
						{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "skill-b"},
					},
				},
			},
		},
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if agent.Spec.SkillRefs[0].Org != "acme" {
		t.Errorf("skill_refs[0].org = %q, want %q", agent.Spec.SkillRefs[0].Org, "acme")
	}
	if agent.Spec.McpServerUsages[0].McpServerRef.Org != "acme" {
		t.Errorf("mcp_server_usages[0].mcp_server_ref.org = %q, want %q",
			agent.Spec.McpServerUsages[0].McpServerRef.Org, "acme")
	}
	if agent.Spec.SubAgents[0].SkillRefs[0].Org != "acme" {
		t.Errorf("sub_agents[0].skill_refs[0].org = %q, want %q",
			agent.Spec.SubAgents[0].SkillRefs[0].Org, "acme")
	}
}

func TestNormalizeReferencesStep_NoSpecField(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Errorf("expected no error for nil spec, got: %v", err)
	}
}

func TestNormalizeReferencesStep_SpecWithoutReferences(t *testing.T) {
	mcpServer := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-mcp-server",
			Org:  "acme",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "A test MCP server",
		},
	}

	step := NewNormalizeReferencesStep[*mcpserverv1.McpServer]()
	ctx := pipeline.NewRequestContext(context.Background(), mcpServer)
	ctx.SetNewState(mcpServer)

	if err := step.Execute(ctx); err != nil {
		t.Errorf("expected no error for spec without references, got: %v", err)
	}
}

func TestNormalizeReferencesStep_EmptyMetadataOrg(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			SkillRefs: []*apiresource.ApiResourceReference{
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "web-search"},
			},
		},
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Errorf("expected no error for empty metadata.org, got: %v", err)
	}

	if agent.Spec.SkillRefs[0].Org != "" {
		t.Errorf("expected org to remain empty when metadata.org is empty, got %q", agent.Spec.SkillRefs[0].Org)
	}
}

func TestNormalizeReferencesStep_NilMetadata(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: nil,
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)
	if err == nil {
		t.Errorf("expected error for nil metadata, got success")
	}
}

func TestNormalizeReferencesStep_Idempotent(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			SkillRefs: []*apiresource.ApiResourceReference{
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "web-search"},
				{Org: "marketplace", Kind: apiresourcekind.ApiResourceKind_skill, Slug: "premium"},
			},
		},
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()

	// Run twice
	for i := 0; i < 2; i++ {
		ctx := pipeline.NewRequestContext(context.Background(), agent)
		ctx.SetNewState(agent)
		if err := step.Execute(ctx); err != nil {
			t.Fatalf("run %d: unexpected error: %v", i+1, err)
		}
	}

	if agent.Spec.SkillRefs[0].Org != "acme" {
		t.Errorf("after two runs, skill_refs[0].org = %q, want %q", agent.Spec.SkillRefs[0].Org, "acme")
	}
	if agent.Spec.SkillRefs[1].Org != "marketplace" {
		t.Errorf("after two runs, skill_refs[1].org = %q, want %q", agent.Spec.SkillRefs[1].Org, "marketplace")
	}
}

func TestNormalizeReferencesStep_EmptySkillRefs(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			SkillRefs:    []*apiresource.ApiResourceReference{},
		},
	}

	step := NewNormalizeReferencesStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Errorf("expected no error for empty skill_refs, got: %v", err)
	}
}

func TestResolveEmptyOrgInSpec_DirectCall(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			SkillRefs: []*apiresource.ApiResourceReference{
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "web-search"},
			},
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "github",
					},
				},
			},
		},
	}

	ResolveEmptyOrgInSpec(agent, "acme")

	if agent.Spec.SkillRefs[0].Org != "acme" {
		t.Errorf("skill_refs[0].org = %q, want %q", agent.Spec.SkillRefs[0].Org, "acme")
	}
	if agent.Spec.McpServerUsages[0].McpServerRef.Org != "acme" {
		t.Errorf("mcp_server_usages[0].mcp_server_ref.org = %q, want %q",
			agent.Spec.McpServerUsages[0].McpServerRef.Org, "acme")
	}
}
