package steps

import (
	"context"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestSetDefaultsStep_Execute(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Test Agent",
		},
	}

	step := NewSetDefaultsStep[*agentv1.Agent](apiresourcekind.ApiResourceKind_agent)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	// Execute
	err := step.Execute(ctx)

	// Verify
	if err != nil {
		t.Errorf("Expected success, got error: %v", err)
	}

	// Check ID was generated
	if agent.Metadata.Id == "" {
		t.Errorf("Expected ID to be generated, got empty string")
	}

	// Check ID format (should start with "agent-")
	if !strings.HasPrefix(agent.Metadata.Id, "agent-") {
		t.Errorf("Expected ID to start with 'agent-', got %q", agent.Metadata.Id)
	}

	// Check ID contains timestamp
	parts := strings.Split(agent.Metadata.Id, "-")
	if len(parts) != 2 {
		t.Errorf("Expected ID format 'agent-{timestamp}', got %q", agent.Metadata.Id)
	}
}

func TestSetDefaultsStep_Idempotent(t *testing.T) {
	// Pre-set ID
	existingID := "agent-123456789"
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Test Agent",
			Id:   existingID,
		},
	}

	step := NewSetDefaultsStep[*agentv1.Agent](apiresourcekind.ApiResourceKind_agent)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
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

func TestSetDefaultsStep_DifferentKinds(t *testing.T) {
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

			step := NewSetDefaultsStep[*agentv1.Agent](tt.kind)
			ctx := pipeline.NewRequestContext(context.Background(), agent)
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

func TestSetDefaultsStep_MultipleResources(t *testing.T) {
	// Create multiple agents and ensure they get different IDs
	ids := make(map[string]bool)

	for i := 0; i < 10; i++ {
		agent := &agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Test Agent",
			},
		}

		step := NewSetDefaultsStep[*agentv1.Agent](apiresourcekind.ApiResourceKind_agent)
		ctx := pipeline.NewRequestContext(context.Background(), agent)
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

func TestSetDefaultsStep_NilMetadata(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: nil,
	}

	step := NewSetDefaultsStep[*agentv1.Agent](apiresourcekind.ApiResourceKind_agent)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected error for nil metadata, got success")
	}
}

func TestSetDefaultsStep_Name(t *testing.T) {
	step := NewSetDefaultsStep[*agentv1.Agent](apiresourcekind.ApiResourceKind_agent)
	if step.Name() != "SetDefaults" {
		t.Errorf("Expected Name()=SetDefaults, got %q", step.Name())
	}
}

func TestGenerateID(t *testing.T) {
	tests := []struct {
		prefix   string
		expected string
	}{
		{"agent", "agent-"},
		{"AGENT", "agent-"},
		{"workflow", "workflow-"},
		{"AgentInstance", "agentinstance-"},
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
		id := generateID("agent")
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
