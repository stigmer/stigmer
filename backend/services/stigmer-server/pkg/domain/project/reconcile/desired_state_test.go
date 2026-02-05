package reconcile

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Test helpers for creating proto fixtures

func createTestAgent(name string) *agentv1.Agent {
	return &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description: "Test agent: " + name,
		},
	}
}

func createTestWorkflow(name string) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Test workflow: " + name,
		},
	}
}

func createTestMcpServer(name string) *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Test MCP server: " + name,
		},
	}
}

func createTestSkill(name string) *skillv1.Skill {
	return &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &skillv1.SkillSpec{
			Description: "Test skill: " + name,
		},
	}
}

func TestEmptyDesiredState(t *testing.T) {
	state := EmptyDesiredState()

	t.Run("is singleton", func(t *testing.T) {
		state2 := EmptyDesiredState()
		if state != state2 {
			t.Error("expected EmptyDesiredState to return same instance")
		}
	})

	t.Run("is empty", func(t *testing.T) {
		if !state.IsEmpty() {
			t.Error("expected empty state to be empty")
		}
	})

	t.Run("resource count is zero", func(t *testing.T) {
		if state.ResourceCount() != 0 {
			t.Errorf("expected resource count 0, got %d", state.ResourceCount())
		}
	})

	t.Run("all resource keys is empty", func(t *testing.T) {
		keys := state.AllResourceKeys()
		if len(keys) != 0 {
			t.Errorf("expected 0 keys, got %d", len(keys))
		}
	})
}

func TestNewDesiredState_WithResources(t *testing.T) {
	agents := map[string]*agentv1.Agent{
		"agent1": createTestAgent("agent1"),
		"agent2": createTestAgent("agent2"),
	}
	workflows := map[string]*workflowv1.Workflow{
		"workflow1": createTestWorkflow("workflow1"),
	}
	mcpServers := map[string]*mcpserverv1.McpServer{
		"mcp1": createTestMcpServer("mcp1"),
	}
	skills := map[string]*skillv1.Skill{
		"skill1": createTestSkill("skill1"),
		"skill2": createTestSkill("skill2"),
	}

	state := NewDesiredState(agents, workflows, mcpServers, skills)

	t.Run("is not empty", func(t *testing.T) {
		if state.IsEmpty() {
			t.Error("expected state to not be empty")
		}
	})

	t.Run("resource count is correct", func(t *testing.T) {
		expected := 6 // 2 agents + 1 workflow + 1 mcp + 2 skills
		if state.ResourceCount() != expected {
			t.Errorf("expected resource count %d, got %d", expected, state.ResourceCount())
		}
	})
}

func TestNewDesiredState_NilMaps(t *testing.T) {
	state := NewDesiredState(nil, nil, nil, nil)

	if !state.IsEmpty() {
		t.Error("expected state with nil maps to be empty")
	}

	if state.ResourceCount() != 0 {
		t.Errorf("expected resource count 0, got %d", state.ResourceCount())
	}

	// Getters should return empty maps, not nil
	if state.Agents() == nil {
		t.Error("expected Agents() to return non-nil map")
	}
	if state.Workflows() == nil {
		t.Error("expected Workflows() to return non-nil map")
	}
	if state.McpServers() == nil {
		t.Error("expected McpServers() to return non-nil map")
	}
	if state.Skills() == nil {
		t.Error("expected Skills() to return non-nil map")
	}
}

func TestNewDesiredState_DefensiveCopy(t *testing.T) {
	original := map[string]*agentv1.Agent{
		"agent1": createTestAgent("agent1"),
	}

	state := NewDesiredState(original, nil, nil, nil)

	// Modify original map
	original["agent2"] = createTestAgent("agent2")

	// State should not be affected
	if state.ResourceCount() != 1 {
		t.Errorf("expected resource count 1, got %d (defensive copy failed)", state.ResourceCount())
	}

	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent2")
	if state.HasResource(key) {
		t.Error("state should not have agent2 (defensive copy failed)")
	}
}

func TestDesiredState_AllResourceKeys(t *testing.T) {
	state := NewDesiredState(
		map[string]*agentv1.Agent{
			"zebra-agent": createTestAgent("zebra-agent"),
			"alpha-agent": createTestAgent("alpha-agent"),
		},
		map[string]*workflowv1.Workflow{
			"pipeline": createTestWorkflow("pipeline"),
		},
		map[string]*mcpserverv1.McpServer{
			"postgres": createTestMcpServer("postgres"),
		},
		map[string]*skillv1.Skill{
			"beta-skill":  createTestSkill("beta-skill"),
			"alpha-skill": createTestSkill("alpha-skill"),
		},
	)

	keys := state.AllResourceKeys()

	// Expected order: agents (sorted), workflows (sorted), mcp_servers (sorted), skills (sorted)
	expected := []string{
		"agent:alpha-agent",
		"agent:zebra-agent",
		"workflow:pipeline",
		"mcp_server:postgres",
		"skill:alpha-skill",
		"skill:beta-skill",
	}

	if len(keys) != len(expected) {
		t.Fatalf("expected %d keys, got %d", len(expected), len(keys))
	}

	for i, key := range keys {
		if key.String() != expected[i] {
			t.Errorf("expected key[%d] = %q, got %q", i, expected[i], key.String())
		}
	}
}

func TestDesiredState_HasResource_Exists(t *testing.T) {
	state := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": createTestAgent("my-agent")},
		map[string]*workflowv1.Workflow{"my-workflow": createTestWorkflow("my-workflow")},
		map[string]*mcpserverv1.McpServer{"my-mcp": createTestMcpServer("my-mcp")},
		map[string]*skillv1.Skill{"my-skill": createTestSkill("my-skill")},
	)

	tests := []struct {
		kind apiresourcekind.ApiResourceKind
		slug string
	}{
		{apiresourcekind.ApiResourceKind_agent, "my-agent"},
		{apiresourcekind.ApiResourceKind_workflow, "my-workflow"},
		{apiresourcekind.ApiResourceKind_mcp_server, "my-mcp"},
		{apiresourcekind.ApiResourceKind_skill, "my-skill"},
	}

	for _, tt := range tests {
		key := MustResourceKey(tt.kind, tt.slug)
		t.Run(key.String(), func(t *testing.T) {
			if !state.HasResource(key) {
				t.Errorf("expected HasResource to return true for %s", key)
			}
		})
	}
}

func TestDesiredState_HasResource_Missing(t *testing.T) {
	state := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": createTestAgent("my-agent")},
		nil, nil, nil,
	)

	tests := []struct {
		name string
		key  ResourceKey
	}{
		{"wrong slug", MustResourceKey(apiresourcekind.ApiResourceKind_agent, "other-agent")},
		{"wrong kind", MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "my-agent")},
		{"empty state kind", MustResourceKey(apiresourcekind.ApiResourceKind_skill, "my-skill")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if state.HasResource(tt.key) {
				t.Errorf("expected HasResource to return false for %s", tt.key)
			}
		})
	}
}

func TestDesiredState_Getters_ReturnCopies(t *testing.T) {
	state := NewDesiredState(
		map[string]*agentv1.Agent{"agent1": createTestAgent("agent1")},
		map[string]*workflowv1.Workflow{"workflow1": createTestWorkflow("workflow1")},
		map[string]*mcpserverv1.McpServer{"mcp1": createTestMcpServer("mcp1")},
		map[string]*skillv1.Skill{"skill1": createTestSkill("skill1")},
	)

	t.Run("agents getter returns copy", func(t *testing.T) {
		agents := state.Agents()
		agents["new-agent"] = createTestAgent("new-agent")

		// State should not be affected
		if len(state.Agents()) != 1 {
			t.Error("modifying returned agents map affected state")
		}
	})

	t.Run("workflows getter returns copy", func(t *testing.T) {
		workflows := state.Workflows()
		workflows["new-workflow"] = createTestWorkflow("new-workflow")

		if len(state.Workflows()) != 1 {
			t.Error("modifying returned workflows map affected state")
		}
	})

	t.Run("mcpServers getter returns copy", func(t *testing.T) {
		mcpServers := state.McpServers()
		mcpServers["new-mcp"] = createTestMcpServer("new-mcp")

		if len(state.McpServers()) != 1 {
			t.Error("modifying returned mcpServers map affected state")
		}
	})

	t.Run("skills getter returns copy", func(t *testing.T) {
		skills := state.Skills()
		skills["new-skill"] = createTestSkill("new-skill")

		if len(state.Skills()) != 1 {
			t.Error("modifying returned skills map affected state")
		}
	})
}

func TestDesiredState_GetResource(t *testing.T) {
	agent := createTestAgent("my-agent")
	workflow := createTestWorkflow("my-workflow")
	mcpServer := createTestMcpServer("my-mcp")
	skill := createTestSkill("my-skill")

	state := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": agent},
		map[string]*workflowv1.Workflow{"my-workflow": workflow},
		map[string]*mcpserverv1.McpServer{"my-mcp": mcpServer},
		map[string]*skillv1.Skill{"my-skill": skill},
	)

	t.Run("returns agent by key", func(t *testing.T) {
		key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
		resource := state.GetResource(key)
		if resource == nil {
			t.Fatal("expected non-nil resource")
		}
		if resource != agent {
			t.Error("expected same agent instance")
		}
	})

	t.Run("returns workflow by key", func(t *testing.T) {
		key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "my-workflow")
		resource := state.GetResource(key)
		if resource == nil {
			t.Fatal("expected non-nil resource")
		}
		if resource != workflow {
			t.Error("expected same workflow instance")
		}
	})

	t.Run("returns mcp_server by key", func(t *testing.T) {
		key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "my-mcp")
		resource := state.GetResource(key)
		if resource == nil {
			t.Fatal("expected non-nil resource")
		}
		if resource != mcpServer {
			t.Error("expected same mcp_server instance")
		}
	})

	t.Run("returns skill by key", func(t *testing.T) {
		key := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "my-skill")
		resource := state.GetResource(key)
		if resource == nil {
			t.Fatal("expected non-nil resource")
		}
		if resource != skill {
			t.Error("expected same skill instance")
		}
	})

	t.Run("returns nil for missing resource", func(t *testing.T) {
		key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "non-existent")
		resource := state.GetResource(key)
		if resource != nil {
			t.Error("expected nil for missing resource")
		}
	})

	t.Run("returns nil for wrong kind", func(t *testing.T) {
		// Resource exists as agent, but we query as workflow
		key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "my-agent")
		resource := state.GetResource(key)
		if resource != nil {
			t.Error("expected nil for wrong kind")
		}
	})
}

func TestDesiredState_TypedGetters(t *testing.T) {
	agent := createTestAgent("my-agent")
	workflow := createTestWorkflow("my-workflow")
	mcpServer := createTestMcpServer("my-mcp")
	skill := createTestSkill("my-skill")

	state := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": agent},
		map[string]*workflowv1.Workflow{"my-workflow": workflow},
		map[string]*mcpserverv1.McpServer{"my-mcp": mcpServer},
		map[string]*skillv1.Skill{"my-skill": skill},
	)

	t.Run("GetAgent returns agent", func(t *testing.T) {
		result := state.GetAgent("my-agent")
		if result != agent {
			t.Error("expected same agent instance")
		}
	})

	t.Run("GetAgent returns nil for missing", func(t *testing.T) {
		result := state.GetAgent("non-existent")
		if result != nil {
			t.Error("expected nil for missing agent")
		}
	})

	t.Run("GetWorkflow returns workflow", func(t *testing.T) {
		result := state.GetWorkflow("my-workflow")
		if result != workflow {
			t.Error("expected same workflow instance")
		}
	})

	t.Run("GetWorkflow returns nil for missing", func(t *testing.T) {
		result := state.GetWorkflow("non-existent")
		if result != nil {
			t.Error("expected nil for missing workflow")
		}
	})

	t.Run("GetMcpServer returns mcp_server", func(t *testing.T) {
		result := state.GetMcpServer("my-mcp")
		if result != mcpServer {
			t.Error("expected same mcp_server instance")
		}
	})

	t.Run("GetMcpServer returns nil for missing", func(t *testing.T) {
		result := state.GetMcpServer("non-existent")
		if result != nil {
			t.Error("expected nil for missing mcp_server")
		}
	})

	t.Run("GetSkill returns skill", func(t *testing.T) {
		result := state.GetSkill("my-skill")
		if result != skill {
			t.Error("expected same skill instance")
		}
	})

	t.Run("GetSkill returns nil for missing", func(t *testing.T) {
		result := state.GetSkill("non-existent")
		if result != nil {
			t.Error("expected nil for missing skill")
		}
	})
}
