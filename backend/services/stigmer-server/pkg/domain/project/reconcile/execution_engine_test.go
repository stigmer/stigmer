package reconcile

import (
	"context"
	"fmt"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// mockResourceDeleter records delete calls for verification.
type mockResourceDeleter struct {
	calls []deleteCall
	err   error
}

type deleteCall struct {
	kind       apiresourcekind.ApiResourceKind
	resourceID string
}

func (m *mockResourceDeleter) Delete(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceID string) error {
	m.calls = append(m.calls, deleteCall{kind: kind, resourceID: resourceID})
	return m.err
}

func TestResourceDeleterAdapter_Delete_Agent(t *testing.T) {
	client := &fakeAgentClient{}
	adapter := NewResourceDeleterAdapter(&DownstreamClients{
		AgentClient: client,
	})

	err := adapter.Delete(context.Background(), apiresourcekind.ApiResourceKind_agent, "agent-123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.deletedID != "agent-123" {
		t.Errorf("expected delete call with ID 'agent-123', got %q", client.deletedID)
	}
}

func TestResourceDeleterAdapter_Delete_Workflow(t *testing.T) {
	client := &fakeWorkflowClient{}
	adapter := NewResourceDeleterAdapter(&DownstreamClients{
		WorkflowClient: client,
	})

	err := adapter.Delete(context.Background(), apiresourcekind.ApiResourceKind_workflow, "wf-456")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.deletedID != "wf-456" {
		t.Errorf("expected delete call with ID 'wf-456', got %q", client.deletedID)
	}
}

func TestResourceDeleterAdapter_Delete_McpServer(t *testing.T) {
	client := &fakeMcpServerClient{}
	adapter := NewResourceDeleterAdapter(&DownstreamClients{
		McpServerClient: client,
	})

	err := adapter.Delete(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp-789")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.deletedID != "mcp-789" {
		t.Errorf("expected delete call with ID 'mcp-789', got %q", client.deletedID)
	}
}

func TestResourceDeleterAdapter_Delete_Skill(t *testing.T) {
	client := &fakeSkillClient{}
	adapter := NewResourceDeleterAdapter(&DownstreamClients{
		SkillClient: client,
	})

	err := adapter.Delete(context.Background(), apiresourcekind.ApiResourceKind_skill, "skill-abc")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.deletedID != "skill-abc" {
		t.Errorf("expected delete call with ID 'skill-abc', got %q", client.deletedID)
	}
}

func TestResourceDeleterAdapter_Delete_UnsupportedKind(t *testing.T) {
	adapter := NewResourceDeleterAdapter(&DownstreamClients{})

	err := adapter.Delete(context.Background(), apiresourcekind.ApiResourceKind_project, "prj-123")
	if err == nil {
		t.Fatal("expected error for unsupported kind")
	}
}

func TestResourceDeleterAdapter_Delete_PropagatesError(t *testing.T) {
	client := &fakeAgentClient{deleteErr: fmt.Errorf("not found")}
	adapter := NewResourceDeleterAdapter(&DownstreamClients{
		AgentClient: client,
	})

	err := adapter.Delete(context.Background(), apiresourcekind.ApiResourceKind_agent, "agent-123")
	if err == nil {
		t.Fatal("expected error to be propagated")
	}
}
