package steps

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestLoadExistingStep_Execute(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	// First, save an agent to the store
	existing := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-123",
			Name: "existing-agent",
		},
		Spec: &agentv1.AgentSpec{
			Description: "Original description",
		},
	}

	// Save to store
	err := store.SaveResource(context.Background(), "agent", "agent-123", existing)
	if err != nil {
		t.Fatalf("Failed to save test agent: %v", err)
	}

	// Now create input agent with same ID
	input := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-123",
			Name: "updated-agent", // Different name
		},
		Spec: &agentv1.AgentSpec{
			Description: "Updated Agent", // Different spec
		},
	}

	// Execute LoadExistingStep
	step := NewLoadExistingStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)

	err = step.Execute(ctx)

	// Verify
	if err != nil {
		t.Errorf("Expected success, got error: %v", err)
	}

	// Check that existing resource was stored in context
	existingFromCtx := ctx.Get(ExistingResourceKey)
	if existingFromCtx == nil {
		t.Fatalf("Expected existing resource in context, got nil")
	}

	loadedAgent, ok := existingFromCtx.(*agentv1.Agent)
	if !ok {
		t.Fatalf("Expected *agentv1.Agent from context, got %T", existingFromCtx)
	}

	// Verify loaded resource matches original
	if loadedAgent.Metadata.Name != "existing-agent" {
		t.Errorf("Expected name=%q, got %q", "existing-agent", loadedAgent.Metadata.Name)
	}
	if loadedAgent.Spec.Description != "Original description" {
		t.Errorf("Expected description=%q, got %q", "Original description", loadedAgent.Spec.Description)
	}
}

func TestLoadExistingStep_NotFound(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	// Create input with non-existent ID
	input := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-nonexistent",
			Name: "test",
		},
	}

	// Execute LoadExistingStep
	step := NewLoadExistingStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)

	err := step.Execute(ctx)

	// Should return NotFound error
	if err == nil {
		t.Errorf("Expected NotFound error, got success")
	}
}

func TestLoadExistingStep_EmptyID(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	// Create input with empty ID
	input := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "", // Empty ID
			Name: "test",
		},
	}

	// Execute LoadExistingStep
	step := NewLoadExistingStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)

	err := step.Execute(ctx)

	// Should return error for missing ID
	if err == nil {
		t.Errorf("Expected error for empty ID, got success")
	}
}

func TestLoadExistingStep_NilMetadata(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	// Create input with nil metadata
	input := &agentv1.Agent{
		Metadata: nil,
	}

	// Execute LoadExistingStep
	step := NewLoadExistingStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)

	err := step.Execute(ctx)

	// Should return error for nil metadata
	if err == nil {
		t.Errorf("Expected error for nil metadata, got success")
	}
}

func TestLoadExistingStep_Name(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	step := NewLoadExistingStep[*agentv1.Agent](store)
	if step.Name() != "LoadExisting" {
		t.Errorf("Expected Name()=LoadExisting, got %q", step.Name())
	}
}
