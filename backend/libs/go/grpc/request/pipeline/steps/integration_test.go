package steps

import (
	"context"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/telemetry"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// TestAgentCreatePipeline_Integration tests the complete agent creation pipeline
func TestAgentCreatePipeline_Integration(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	// Create a minimal agent
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "My Test Agent",
		},
	}

	// Build pipeline
	p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
		WithTracer(telemetry.NewNoOpTracer()).
		AddStep(NewResolveSlugStep[*agentv1.Agent]()).
		AddStep(NewCheckDuplicateStep[*agentv1.Agent](store)).
		AddStep(NewBuildNewStateStep[*agentv1.Agent]()).
		AddStep(NewPersistStep[*agentv1.Agent](store)).
		Build()

	// Execute
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)
	err := p.Execute(ctx)

	if err != nil {
		t.Fatalf("Pipeline execution failed: %v", err)
	}

	// Verify slug
	if agent.Metadata.Slug != "my-test-agent" {
		t.Errorf("Expected slug='my-test-agent', got %q", agent.Metadata.Slug)
	}

	// Verify ID
	if agent.Metadata.Id == "" {
		t.Errorf("Expected ID to be generated")
	}
	if !strings.HasPrefix(agent.Metadata.Id, "agt-") {
		t.Errorf("Expected ID to start with 'agt-', got %q", agent.Metadata.Id)
	}

	// Verify audit fields
	if agent.Status == nil || agent.Status.Audit == nil {
		t.Errorf("Expected audit fields to be set")
	}

	// Verify persistence
	retrieved := &agentv1.Agent{}
	err = store.GetResource(context.Background(), "agent", agent.Metadata.Id, retrieved)
	if err != nil {
		t.Errorf("Failed to retrieve agent: %v", err)
	}

	if retrieved.Metadata.Name != "My Test Agent" {
		t.Errorf("Expected name='My Test Agent', got %q", retrieved.Metadata.Name)
	}
}
