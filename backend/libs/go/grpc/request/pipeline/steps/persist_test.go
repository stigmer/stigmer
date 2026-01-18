package steps

import (
	"context"
	"fmt"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/sqlite"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource/apiresourcekind"
)

func setupTestStore(t *testing.T) *sqlite.Store {
	// Create an in-memory SQLite database for testing
	store, err := sqlite.NewStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create test store: %v", err)
	}
	return store
}

func TestPersistStep_Execute(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-123",
			Name: "Test Agent",
		},
		Kind:       "Agent",
		ApiVersion: "ai.stigmer.agentic.agent/v1",
	}

	step := NewPersistStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)

	// Execute
	err := step.Execute(ctx)

	// Verify
	if err != nil {
		t.Errorf("Expected success, got error: %v", err)
	}

	// Verify resource was saved to store
	retrieved := &agentv1.Agent{}
	err = store.GetResource(context.Background(), "agent", "agent-123", retrieved)
	if err != nil {
		t.Errorf("Failed to retrieve saved resource: %v", err)
	}

	// Verify data matches
	if retrieved.Metadata.Id != agent.Metadata.Id {
		t.Errorf("Expected ID=%q, got %q", agent.Metadata.Id, retrieved.Metadata.Id)
	}
	if retrieved.Metadata.Name != agent.Metadata.Name {
		t.Errorf("Expected Name=%q, got %q", agent.Metadata.Name, retrieved.Metadata.Name)
	}
}

func TestPersistStep_Update(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	// Save initial version
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-123",
			Name: "Test Agent V1",
		},
		Kind:       "Agent",
		ApiVersion: "ai.stigmer.agentic.agent/v1",
	}

	step := NewPersistStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)
	step.Execute(ctx)

	// Update the agent
	agent.Metadata.Name = "Test Agent V2"
	ctx.SetNewState(agent)
	step.Execute(ctx)

	// Verify updated version was saved
	retrieved := &agentv1.Agent{}
	err := store.GetResource(context.Background(), "agent", "agent-123", retrieved)
	if err != nil {
		t.Errorf("Failed to retrieve updated resource: %v", err)
	}

	if retrieved.Metadata.Name != "Test Agent V2" {
		t.Errorf("Expected Name=%q, got %q", "Test Agent V2", retrieved.Metadata.Name)
	}
}

func TestPersistStep_EmptyID(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "", // Empty ID
			Name: "Test Agent",
		},
	}

	step := NewPersistStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected error for empty ID, got success")
	}
}

func TestPersistStep_NilMetadata(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	agent := &agentv1.Agent{
		Metadata: nil,
	}

	step := NewPersistStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected error for nil metadata, got success")
	}
}

func TestPersistStep_MultipleResources(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	step := NewPersistStep[*agentv1.Agent](store)

	// Save multiple agents
	for i := 1; i <= 5; i++ {
		agent := &agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   fmt.Sprintf("agent-%d", i),
				Name: fmt.Sprintf("Agent %d", i),
			},
			Kind:       "Agent",
			ApiVersion: "ai.stigmer.agentic.agent/v1",
		}

		ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
		ctx.SetNewState(agent)
		err := step.Execute(ctx)

		if err != nil {
			t.Errorf("Failed to save agent-%d: %v", i, err)
		}
	}

	// Verify all agents were saved
	for i := 1; i <= 5; i++ {
		retrieved := &agentv1.Agent{}
		err := store.GetResource(context.Background(), "agent", fmt.Sprintf("agent-%d", i), retrieved)
		if err != nil {
			t.Errorf("Failed to retrieve agent-%d: %v", i, err)
		}
	}
}

func TestPersistStep_Name(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	step := NewPersistStep[*agentv1.Agent](store)
	if step.Name() != "Persist" {
		t.Errorf("Expected Name()=Persist, got %q", step.Name())
	}
}
