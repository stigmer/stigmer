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

// Test helpers with ID support for ActualState tests

func createTestAgentWithID(name, id string) *agentv1.Agent {
	return &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Id:   id,
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description: "Test agent: " + name,
		},
	}
}

func createTestWorkflowWithID(name, id string) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Id:   id,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Test workflow: " + name,
		},
	}
}

func createTestMcpServerWithID(name, id string) *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Id:   id,
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Test MCP server: " + name,
		},
	}
}

func createTestSkillWithID(name, id string) *skillv1.Skill {
	return &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Id:   id,
			Org:  "test-org",
		},
		Spec: &skillv1.SkillSpec{
			Description: "Test skill: " + name,
		},
	}
}

func TestEmptyActualState(t *testing.T) {
	state := EmptyActualState()

	t.Run("is singleton", func(t *testing.T) {
		state2 := EmptyActualState()
		if state != state2 {
			t.Error("expected EmptyActualState to return same instance")
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

func TestNewActualState_WithResources(t *testing.T) {
	agents := map[string]*agentv1.Agent{
		"agent1": createTestAgentWithID("agent1", "agt_123"),
		"agent2": createTestAgentWithID("agent2", "agt_456"),
	}
	workflows := map[string]*workflowv1.Workflow{
		"workflow1": createTestWorkflowWithID("workflow1", "wfl_123"),
	}
	mcpServers := map[string]*mcpserverv1.McpServer{
		"mcp1": createTestMcpServerWithID("mcp1", "mcp_123"),
	}
	skills := map[string]*skillv1.Skill{
		"skill1": createTestSkillWithID("skill1", "skl_123"),
	}

	state := NewActualState(agents, workflows, mcpServers, skills)

	t.Run("is not empty", func(t *testing.T) {
		if state.IsEmpty() {
			t.Error("expected state to not be empty")
		}
	})

	t.Run("resource count is correct", func(t *testing.T) {
		expected := 5 // 2 agents + 1 workflow + 1 mcp + 1 skill
		if state.ResourceCount() != expected {
			t.Errorf("expected resource count %d, got %d", expected, state.ResourceCount())
		}
	})
}

func TestNewActualState_DefensiveCopy(t *testing.T) {
	original := map[string]*agentv1.Agent{
		"agent1": createTestAgentWithID("agent1", "agt_123"),
	}

	state := NewActualState(original, nil, nil, nil)

	// Modify original map
	original["agent2"] = createTestAgentWithID("agent2", "agt_456")

	// State should not be affected
	if state.ResourceCount() != 1 {
		t.Errorf("expected resource count 1, got %d (defensive copy failed)", state.ResourceCount())
	}

	if state.GetAgent("agent2") != nil {
		t.Error("state should not have agent2 (defensive copy failed)")
	}
}

func TestActualState_GetResource_Agent(t *testing.T) {
	agent := createTestAgentWithID("my-agent", "agt_abc123")
	state := NewActualState(
		map[string]*agentv1.Agent{"my-agent": agent},
		nil, nil, nil,
	)

	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	result := state.GetResource(key)

	if result == nil {
		t.Fatal("expected GetResource to return agent, got nil")
	}

	if result != agent {
		t.Error("expected GetResource to return the same agent instance")
	}
}

func TestActualState_GetResource_Missing(t *testing.T) {
	state := EmptyActualState()

	tests := []struct {
		name string
		key  ResourceKey
	}{
		{"missing agent", MustResourceKey(apiresourcekind.ApiResourceKind_agent, "missing")},
		{"missing workflow", MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "missing")},
		{"missing mcp_server", MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "missing")},
		{"missing skill", MustResourceKey(apiresourcekind.ApiResourceKind_skill, "missing")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := state.GetResource(tt.key)
			if result != nil {
				t.Errorf("expected GetResource to return nil for %s, got %v", tt.key, result)
			}
		})
	}
}

func TestActualState_GetResourceID_Exists(t *testing.T) {
	state := NewActualState(
		map[string]*agentv1.Agent{"my-agent": createTestAgentWithID("my-agent", "agt_abc123")},
		map[string]*workflowv1.Workflow{"my-workflow": createTestWorkflowWithID("my-workflow", "wfl_xyz789")},
		map[string]*mcpserverv1.McpServer{"my-mcp": createTestMcpServerWithID("my-mcp", "mcp_def456")},
		map[string]*skillv1.Skill{"my-skill": createTestSkillWithID("my-skill", "skl_ghi012")},
	)

	tests := []struct {
		kind       apiresourcekind.ApiResourceKind
		slug       string
		expectedID string
	}{
		{apiresourcekind.ApiResourceKind_agent, "my-agent", "agt_abc123"},
		{apiresourcekind.ApiResourceKind_workflow, "my-workflow", "wfl_xyz789"},
		{apiresourcekind.ApiResourceKind_mcp_server, "my-mcp", "mcp_def456"},
		{apiresourcekind.ApiResourceKind_skill, "my-skill", "skl_ghi012"},
	}

	for _, tt := range tests {
		key := MustResourceKey(tt.kind, tt.slug)
		t.Run(key.String(), func(t *testing.T) {
			id := state.GetResourceID(key)
			if id != tt.expectedID {
				t.Errorf("expected ID %q, got %q", tt.expectedID, id)
			}
		})
	}
}

func TestActualState_GetResourceID_Missing(t *testing.T) {
	state := EmptyActualState()

	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "missing")
	id := state.GetResourceID(key)

	if id != "" {
		t.Errorf("expected empty string for missing resource, got %q", id)
	}
}

func TestActualState_AllResourceKeys(t *testing.T) {
	state := NewActualState(
		map[string]*agentv1.Agent{
			"zebra-agent": createTestAgentWithID("zebra-agent", "agt_1"),
			"alpha-agent": createTestAgentWithID("alpha-agent", "agt_2"),
		},
		map[string]*workflowv1.Workflow{
			"pipeline": createTestWorkflowWithID("pipeline", "wfl_1"),
		},
		nil,
		map[string]*skillv1.Skill{
			"beta-skill": createTestSkillWithID("beta-skill", "skl_1"),
		},
	)

	keys := state.AllResourceKeys()

	// Expected order: agents (sorted), workflows (sorted), mcp_servers (none), skills (sorted)
	expected := []string{
		"agent:alpha-agent",
		"agent:zebra-agent",
		"workflow:pipeline",
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

func TestActualState_TypedGetters(t *testing.T) {
	agent := createTestAgentWithID("my-agent", "agt_123")
	workflow := createTestWorkflowWithID("my-workflow", "wfl_123")
	mcpServer := createTestMcpServerWithID("my-mcp", "mcp_123")
	skill := createTestSkillWithID("my-skill", "skl_123")

	state := NewActualState(
		map[string]*agentv1.Agent{"my-agent": agent},
		map[string]*workflowv1.Workflow{"my-workflow": workflow},
		map[string]*mcpserverv1.McpServer{"my-mcp": mcpServer},
		map[string]*skillv1.Skill{"my-skill": skill},
	)

	t.Run("GetAgent returns correct agent", func(t *testing.T) {
		result := state.GetAgent("my-agent")
		if result != agent {
			t.Error("expected GetAgent to return the correct agent")
		}
	})

	t.Run("GetAgent returns nil for missing", func(t *testing.T) {
		result := state.GetAgent("missing")
		if result != nil {
			t.Error("expected GetAgent to return nil for missing agent")
		}
	})

	t.Run("GetWorkflow returns correct workflow", func(t *testing.T) {
		result := state.GetWorkflow("my-workflow")
		if result != workflow {
			t.Error("expected GetWorkflow to return the correct workflow")
		}
	})

	t.Run("GetMcpServer returns correct mcp server", func(t *testing.T) {
		result := state.GetMcpServer("my-mcp")
		if result != mcpServer {
			t.Error("expected GetMcpServer to return the correct mcp server")
		}
	})

	t.Run("GetSkill returns correct skill", func(t *testing.T) {
		result := state.GetSkill("my-skill")
		if result != skill {
			t.Error("expected GetSkill to return the correct skill")
		}
	})
}
