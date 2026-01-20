package steps

import (
	"context"
	"strings"
	"testing"

	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Helper function to create a context with api_resource_kind injected
func contextWithKind(kind apiresourcekind.ApiResourceKind) context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, kind)
}

func TestBuildNewStateStep_Execute(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Test Agent",
		},
		Status: &agentv1.AgentStatus{}, // Pre-initialize status for audit fields
	}

	step := NewBuildNewStateStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)

	// Execute
	err := step.Execute(ctx)

	// Verify
	if err != nil {
		t.Errorf("Expected success, got error: %v", err)
	}

	// Get the agent from context (should be the same object)
	resultAgent := ctx.NewState()
	if resultAgent != agent {
		t.Errorf("Context returned different agent object")
	}

	// Check ID was generated
	if agent.Metadata.Id == "" {
		t.Errorf("Expected ID to be generated, got empty string")
	}

	// Check ID format (should start with "agt-" for agent kind)
	if !strings.HasPrefix(agent.Metadata.Id, "agt-") {
		t.Errorf("Expected ID to start with 'agt-', got %q", agent.Metadata.Id)
	}

	// Check ID contains timestamp
	parts := strings.Split(agent.Metadata.Id, "-")
	if len(parts) != 2 {
		t.Errorf("Expected ID format 'agt-{timestamp}', got %q", agent.Metadata.Id)
	}

	// Check audit fields were set using proto reflection
	// Get status via typed getter first (same way the step does it)
	if resultAgent.Status == nil {
		t.Fatalf("Expected status to be set")
	}

	statusMsg := resultAgent.Status.ProtoReflect()
	auditField := statusMsg.Descriptor().Fields().ByName("audit")
	if !statusMsg.Has(auditField) {
		t.Fatalf("Expected audit field to be set")
	}

	auditMsg := statusMsg.Get(auditField).Message()
	
	// Check spec_audit
	specAuditField := auditMsg.Descriptor().Fields().ByName("spec_audit")
	if !auditMsg.Has(specAuditField) {
		t.Errorf("Expected spec_audit to be set")
	}
	
	// Check status_audit
	statusAuditField := auditMsg.Descriptor().Fields().ByName("status_audit")
	if !auditMsg.Has(statusAuditField) {
		t.Errorf("Expected status_audit to be set")
	}

	// Check event field
	specAuditMsg := auditMsg.Get(specAuditField).Message()
	eventField := specAuditMsg.Descriptor().Fields().ByName("event")
	if specAuditMsg.Get(eventField).String() != "created" {
		t.Errorf("Expected event='created', got %q", specAuditMsg.Get(eventField).String())
	}
}

func TestBuildNewStateStep_Idempotent(t *testing.T) {
	// Pre-set ID
	existingID := "agt-123456789"
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Test Agent",
			Id:   existingID,
		},
	}

	step := NewBuildNewStateStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)

	// Execute
	err := step.Execute(ctx)

	// Verify
	if err != nil {
		t.Errorf("Expected success, got error: %v", err)
	}

	// Check that existing ID was NOT overwritten (idempotent)
	if agent.Metadata.Id != existingID {
		t.Errorf("Expected ID to remain %q, got %q", existingID, agent.Metadata.Id)
	}
}

func TestBuildNewStateStep_DifferentKinds(t *testing.T) {
	tests := []struct {
		name     string
		kind     apiresourcekind.ApiResourceKind
		expected string
	}{
		{"agent kind", apiresourcekind.ApiResourceKind_agent, "agt-"},
		{"workflow kind", apiresourcekind.ApiResourceKind_workflow, "wfl-"},
		{"agent_instance kind", apiresourcekind.ApiResourceKind_agent_instance, "ain-"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &agentv1.Agent{
				Metadata: &apiresource.ApiResourceMetadata{
					Name: "Test",
				},
			}

			step := NewBuildNewStateStep[*agentv1.Agent]()
			ctx := pipeline.NewRequestContext(contextWithKind(tt.kind), agent)
			ctx.SetNewState(agent)

			err := step.Execute(ctx)

			if err != nil {
				t.Errorf("Expected success, got error: %v", err)
			}

			if !strings.HasPrefix(agent.Metadata.Id, tt.expected) {
				t.Errorf("Expected ID to start with %q, got %q", tt.expected, agent.Metadata.Id)
			}
		})
	}
}

func TestBuildNewStateStep_MultipleResources(t *testing.T) {
	// Create multiple agents and ensure they get different IDs
	ids := make(map[string]bool)

	for i := 0; i < 10; i++ {
		agent := &agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Test Agent",
			},
		}

		step := NewBuildNewStateStep[*agentv1.Agent]()
		ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
		ctx.SetNewState(agent)
		step.Execute(ctx)

		// Check for duplicate IDs
		if ids[agent.Metadata.Id] {
			t.Errorf("Duplicate ID generated: %q", agent.Metadata.Id)
		}
		ids[agent.Metadata.Id] = true
	}

	// Should have 10 unique IDs
	if len(ids) != 10 {
		t.Errorf("Expected 10 unique IDs, got %d", len(ids))
	}
}

func TestBuildNewStateStep_NilMetadata(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: nil,
	}

	step := NewBuildNewStateStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected error for nil metadata, got success")
	}
}

func TestBuildNewStateStep_Name(t *testing.T) {
	step := NewBuildNewStateStep[*agentv1.Agent]()
	if step.Name() != "BuildNewState" {
		t.Errorf("Expected Name()=BuildNewState, got %q", step.Name())
	}
}

func TestGenerateID(t *testing.T) {
	tests := []struct {
		prefix   string
		expected string
	}{
		{"agt", "agt-"},
		{"wfl", "wfl-"},
		{"ain", "ain-"},
	}

	for _, tt := range tests {
		t.Run(tt.prefix, func(t *testing.T) {
			id := generateID(tt.prefix)

			if !strings.HasPrefix(id, tt.expected) {
				t.Errorf("generateID(%q) should start with %q, got %q", tt.prefix, tt.expected, id)
			}

			// Check that the suffix is a number
			parts := strings.Split(id, "-")
			if len(parts) != 2 {
				t.Errorf("Expected ID format '{prefix}-{timestamp}', got %q", id)
			}
		})
	}
}

func TestGenerateID_Uniqueness(t *testing.T) {
	// Generate multiple IDs and ensure they're unique
	ids := make(map[string]bool)

	for i := 0; i < 100; i++ {
		id := generateID("agt")
		if ids[id] {
			t.Errorf("Duplicate ID generated: %q", id)
		}
		ids[id] = true
	}

	// Should have 100 unique IDs
	if len(ids) != 100 {
		t.Errorf("Expected 100 unique IDs, got %d", len(ids))
	}
}
