package steps

import (
	"context"
	"fmt"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestCheckDuplicateStep_NoDuplicate(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: "test-agent",
			Name: "Test Agent",
		},
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store, apiresourcekind.ApiResourceKind_agent)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	// Execute (no existing resources, should succeed)
	err := step.Execute(ctx)

	if err != nil {
		t.Errorf("Expected success when no duplicate exists, got error: %v", err)
	}
}

func TestCheckDuplicateStep_DuplicateExists(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	// Save an existing agent
	existing := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-existing",
			Slug: "test-agent",
			Name: "Existing Agent",
		},
		Kind:       "Agent",
		ApiVersion: "ai.stigmer.agentic.agent/v1",
	}
	store.SaveResource(context.Background(), "Agent", existing.Metadata.Id, existing)

	// Try to create another agent with same slug
	newAgent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: "test-agent", // Same slug
			Name: "New Agent",
		},
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store, apiresourcekind.ApiResourceKind_agent)
	ctx := pipeline.NewRequestContext(context.Background(), newAgent)
	ctx.SetNewState(newAgent)

	// Execute (should fail with duplicate error)
	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected duplicate error, got success")
	}
}


func TestCheckDuplicateStep_EmptySlug(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: "", // Empty slug
			Name: "Test Agent",
		},
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store, apiresourcekind.ApiResourceKind_agent)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected error for empty slug, got success")
	}
}

func TestCheckDuplicateStep_NilMetadata(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	agent := &agentv1.Agent{
		Metadata: nil,
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store, apiresourcekind.ApiResourceKind_agent)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected error for nil metadata, got success")
	}
}

func TestCheckDuplicateStep_MultipleSlugs(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	// Save multiple agents with different slugs
	agents := []string{
		"agent-1",
		"agent-2",
		"agent-3",
	}

	for i, slug := range agents {
		agent := &agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   fmt.Sprintf("agent-%d", i),
				Slug: slug,
				Name: fmt.Sprintf("Agent %d", i),
			},
			Kind:       "Agent",
			ApiVersion: "ai.stigmer.agentic.agent/v1",
		}
		store.SaveResource(context.Background(), "Agent", agent.Metadata.Id, agent)
	}

	// Try to create duplicate
	newAgent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: "agent-1",
			Name: "New Agent",
		},
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store, apiresourcekind.ApiResourceKind_agent)
	ctx := pipeline.NewRequestContext(context.Background(), newAgent)
	ctx.SetNewState(newAgent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected duplicate error, got success")
	}
}

func TestCheckDuplicateStep_Name(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	step := NewCheckDuplicateStep[*agentv1.Agent](store, apiresourcekind.ApiResourceKind_agent)
	if step.Name() != "CheckDuplicate" {
		t.Errorf("Expected Name()=CheckDuplicate, got %q", step.Name())
	}
}
