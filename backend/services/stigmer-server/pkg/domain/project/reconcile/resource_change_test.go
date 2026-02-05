package reconcile

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestNewCreateChange(t *testing.T) {
	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "test-agent")
	agent := createTestAgentForChange("test-agent")

	change := NewCreateChange(key, agent)

	t.Run("has correct key", func(t *testing.T) {
		if change.Key() != key {
			t.Errorf("expected key %v, got %v", key, change.Key())
		}
	})

	t.Run("has create type", func(t *testing.T) {
		if change.ChangeType() != ChangeTypeCreate {
			t.Errorf("expected ChangeTypeCreate, got %v", change.ChangeType())
		}
	})

	t.Run("has desired state", func(t *testing.T) {
		if change.DesiredState() == nil {
			t.Error("expected desired state to be non-nil")
		}
	})

	t.Run("has nil actual state", func(t *testing.T) {
		if change.ActualState() != nil {
			t.Error("expected actual state to be nil for create")
		}
	})
}

func TestNewUpdateChange(t *testing.T) {
	key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "pipeline")
	desired := createTestWorkflowForChange("pipeline", "v2")
	actual := createTestWorkflowForChange("pipeline", "v1")

	change := NewUpdateChange(key, desired, actual)

	t.Run("has correct key", func(t *testing.T) {
		if change.Key() != key {
			t.Errorf("expected key %v, got %v", key, change.Key())
		}
	})

	t.Run("has update type", func(t *testing.T) {
		if change.ChangeType() != ChangeTypeUpdate {
			t.Errorf("expected ChangeTypeUpdate, got %v", change.ChangeType())
		}
	})

	t.Run("has desired state", func(t *testing.T) {
		if change.DesiredState() == nil {
			t.Error("expected desired state to be non-nil")
		}
	})

	t.Run("has actual state", func(t *testing.T) {
		if change.ActualState() == nil {
			t.Error("expected actual state to be non-nil")
		}
	})
}

func TestNewDeleteChange(t *testing.T) {
	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "orphan-agent")
	actual := createTestAgentForChange("orphan-agent")

	change := NewDeleteChange(key, actual)

	t.Run("has correct key", func(t *testing.T) {
		if change.Key() != key {
			t.Errorf("expected key %v, got %v", key, change.Key())
		}
	})

	t.Run("has delete type", func(t *testing.T) {
		if change.ChangeType() != ChangeTypeDelete {
			t.Errorf("expected ChangeTypeDelete, got %v", change.ChangeType())
		}
	})

	t.Run("has nil desired state", func(t *testing.T) {
		if change.DesiredState() != nil {
			t.Error("expected desired state to be nil for delete")
		}
	})

	t.Run("has actual state", func(t *testing.T) {
		if change.ActualState() == nil {
			t.Error("expected actual state to be non-nil")
		}
	})
}

func TestResourceChange_TypeHelpers(t *testing.T) {
	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "test")
	agent := createTestAgentForChange("test")

	tests := []struct {
		name     string
		change   ResourceChange
		isCreate bool
		isUpdate bool
		isDelete bool
	}{
		{
			name:     "create change",
			change:   NewCreateChange(key, agent),
			isCreate: true,
			isUpdate: false,
			isDelete: false,
		},
		{
			name:     "update change",
			change:   NewUpdateChange(key, agent, agent),
			isCreate: false,
			isUpdate: true,
			isDelete: false,
		},
		{
			name:     "delete change",
			change:   NewDeleteChange(key, agent),
			isCreate: false,
			isUpdate: false,
			isDelete: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.change.IsCreate() != tt.isCreate {
				t.Errorf("IsCreate() = %v, expected %v", tt.change.IsCreate(), tt.isCreate)
			}
			if tt.change.IsUpdate() != tt.isUpdate {
				t.Errorf("IsUpdate() = %v, expected %v", tt.change.IsUpdate(), tt.isUpdate)
			}
			if tt.change.IsDelete() != tt.isDelete {
				t.Errorf("IsDelete() = %v, expected %v", tt.change.IsDelete(), tt.isDelete)
			}
		})
	}
}

func TestResourceChange_String(t *testing.T) {
	tests := []struct {
		name     string
		change   ResourceChange
		expected string
	}{
		{
			name: "create agent",
			change: NewCreateChange(
				MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent"),
				createTestAgentForChange("my-agent"),
			),
			expected: "create agent:my-agent",
		},
		{
			name: "update workflow",
			change: NewUpdateChange(
				MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "pipeline"),
				createTestWorkflowForChange("pipeline", "v2"),
				createTestWorkflowForChange("pipeline", "v1"),
			),
			expected: "update workflow:pipeline",
		},
		{
			name: "delete mcp_server",
			change: NewDeleteChange(
				MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "old-db"),
				nil,
			),
			expected: "delete mcp_server:old-db",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.change.String() != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, tt.change.String())
			}
		})
	}
}

func TestResourceChange_Getters(t *testing.T) {
	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "test-agent")
	desired := createTestAgentForChange("test-agent")
	actual := createTestAgentForChange("test-agent-old")

	change := NewUpdateChange(key, desired, actual)

	t.Run("Key returns correct key", func(t *testing.T) {
		if change.Key() != key {
			t.Errorf("expected key %v, got %v", key, change.Key())
		}
	})

	t.Run("ChangeType returns correct type", func(t *testing.T) {
		if change.ChangeType() != ChangeTypeUpdate {
			t.Errorf("expected ChangeTypeUpdate, got %v", change.ChangeType())
		}
	})

	t.Run("DesiredState returns correct proto", func(t *testing.T) {
		if change.DesiredState() != desired {
			t.Error("expected same desired state proto")
		}
	})

	t.Run("ActualState returns correct proto", func(t *testing.T) {
		if change.ActualState() != actual {
			t.Error("expected same actual state proto")
		}
	})
}

func TestResourceChange_NilStates(t *testing.T) {
	key := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "test-skill")

	t.Run("create has nil actual state", func(t *testing.T) {
		change := NewCreateChange(key, nil) // Even with nil desired for test
		if change.ActualState() != nil {
			t.Error("create change should have nil actual state")
		}
	})

	t.Run("delete has nil desired state", func(t *testing.T) {
		change := NewDeleteChange(key, nil) // Even with nil actual for test
		if change.DesiredState() != nil {
			t.Error("delete change should have nil desired state")
		}
	})

	t.Run("update can have both states", func(t *testing.T) {
		agent := createTestAgentForChange("test")
		change := NewUpdateChange(key, agent, agent)
		if change.DesiredState() == nil || change.ActualState() == nil {
			t.Error("update change should have both states")
		}
	})
}

func TestResourceChange_IsZero(t *testing.T) {
	t.Run("zero value is zero", func(t *testing.T) {
		var change ResourceChange
		if !change.IsZero() {
			t.Error("expected zero value to be zero")
		}
	})

	t.Run("created change is not zero", func(t *testing.T) {
		key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "test")
		change := NewCreateChange(key, nil)
		if change.IsZero() {
			t.Error("expected created change to not be zero")
		}
	})
}

// Test helpers

func createTestAgentForChange(name string) *agentv1.Agent {
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

func createTestWorkflowForChange(name, descSuffix string) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Test workflow: " + name + " " + descSuffix,
		},
	}
}
