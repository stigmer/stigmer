package steps

import (
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	commonspb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// TestLoadForApplyStep_ResourceExists tests the happy path where resource exists
func TestLoadForApplyStep_ResourceExists(t *testing.T) {
	// Setup
	store := setupTestStore(t)
	defer store.Close()
	
	ctx := contextWithKind(apiresourcekind.ApiResourceKind_agent)

	// Create existing resource in store
	existing := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &commonspb.ApiResourceMetadata{
			Id:   "existing-id-123",
			Name: "test-agent",
			Slug: "test-agent",
		},
		Spec: &agentv1.AgentSpec{
			Description: "Existing agent",
		},
	}

	err := store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, "existing-id-123", existing)
	if err != nil {
		t.Fatalf("Failed to save test resource: %v", err)
	}

	// Create input (apply request) with same slug
	input := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &commonspb.ApiResourceMetadata{
			Name: "test-agent",
			Slug: "test-agent", // Same slug as existing
		},
		Spec: &agentv1.AgentSpec{
			Description: "Updated description",
		},
	}

	// Create request context
	reqCtx := pipeline.NewRequestContext(ctx, input)
	reqCtx.SetNewState(input)

	// Execute step
	step := NewLoadForApplyStep[*agentv1.Agent](store)
	err = step.Execute(reqCtx)

	// Assert
	if err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}
	
	if reqCtx.Get(ExistsInDatabaseKey) != true {
		t.Errorf("Expected exists flag to be true")
	}
	
	if reqCtx.Get(ShouldCreateKey) != false {
		t.Errorf("Expected shouldCreate to be false (UPDATE)")
	}

	// Verify existing resource is stored in context
	existingFromCtx := reqCtx.Get(ExistingResourceKey)
	if existingFromCtx == nil {
		t.Fatalf("Expected existing resource in context")
	}
	
	if existingFromCtx.(*agentv1.Agent).GetMetadata().GetId() != "existing-id-123" {
		t.Errorf("Expected existing ID to be 'existing-id-123'")
	}

	// Verify input metadata.id is populated with existing ID
	if input.GetMetadata().GetId() != "existing-id-123" {
		t.Errorf("Expected input ID to be populated with 'existing-id-123', got %q", input.GetMetadata().GetId())
	}
}

// TestLoadForApplyStep_ResourceDoesNotExist tests when resource doesn't exist (create path)
func TestLoadForApplyStep_ResourceDoesNotExist(t *testing.T) {
	// Setup
	store := setupTestStore(t)
	defer store.Close()
	
	ctx := contextWithKind(apiresourcekind.ApiResourceKind_agent)

	// Create input (no existing resource)
	input := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &commonspb.ApiResourceMetadata{
			Name: "new-agent",
			Slug: "new-agent",
		},
		Spec: &agentv1.AgentSpec{
			Description: "New agent",
		},
	}

	// Create request context
	reqCtx := pipeline.NewRequestContext(ctx, input)
	reqCtx.SetNewState(input)

	// Execute step
	step := NewLoadForApplyStep[*agentv1.Agent](store)
	err := step.Execute(reqCtx)

	// Assert
	if err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}
	
	if reqCtx.Get(ExistsInDatabaseKey) != false {
		t.Errorf("Expected exists flag to be false")
	}
	
	if reqCtx.Get(ShouldCreateKey) != true {
		t.Errorf("Expected shouldCreate to be true (CREATE)")
	}

	// Verify no existing resource in context
	existingFromCtx := reqCtx.Get(ExistingResourceKey)
	if existingFromCtx != nil {
		t.Errorf("Expected no existing resource when not found")
	}
}

// TestLoadForApplyStep_NoSlug tests when no slug is provided
func TestLoadForApplyStep_NoSlug(t *testing.T) {
	// Setup
	store := setupTestStore(t)
	defer store.Close()
	
	ctx := contextWithKind(apiresourcekind.ApiResourceKind_agent)

	// Create input without slug
	input := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &commonspb.ApiResourceMetadata{
			Name: "agent-without-slug",
			// No Slug
		},
		Spec: &agentv1.AgentSpec{
			Description: "Agent without slug",
		},
	}

	// Create request context
	reqCtx := pipeline.NewRequestContext(ctx, input)
	reqCtx.SetNewState(input)

	// Execute step
	step := NewLoadForApplyStep[*agentv1.Agent](store)
	err := step.Execute(reqCtx)

	// Assert - should default to CREATE when no slug
	if err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}
	
	if reqCtx.Get(ExistsInDatabaseKey) != false {
		t.Errorf("Expected exists flag to be false")
	}
	
	if reqCtx.Get(ShouldCreateKey) != true {
		t.Errorf("Expected shouldCreate to be true (CREATE)")
	}
}

// TestLoadForApplyStep_NoMetadata tests when resource has no metadata
func TestLoadForApplyStep_NoMetadata(t *testing.T) {
	// Setup
	store := setupTestStore(t)
	defer store.Close()
	
	ctx := contextWithKind(apiresourcekind.ApiResourceKind_agent)

	// Create input without metadata (edge case)
	input := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		// No Metadata
		Spec: &agentv1.AgentSpec{
			Description: "Agent without metadata",
		},
	}

	// Create request context
	reqCtx := pipeline.NewRequestContext(ctx, input)
	reqCtx.SetNewState(input)

	// Execute step
	step := NewLoadForApplyStep[*agentv1.Agent](store)
	err := step.Execute(reqCtx)

	// Assert - should default to CREATE when no metadata
	if err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}
	
	if reqCtx.Get(ExistsInDatabaseKey) != false {
		t.Errorf("Expected exists flag to be false")
	}
	
	if reqCtx.Get(ShouldCreateKey) != true {
		t.Errorf("Expected shouldCreate to be true (CREATE)")
	}
}

// TestLoadForApplyStep_IntegrationWithPipeline tests the step in a real pipeline
func TestLoadForApplyStep_IntegrationWithPipeline(t *testing.T) {
	// Setup
	store := setupTestStore(t)
	defer store.Close()
	
	ctx := contextWithKind(apiresourcekind.ApiResourceKind_agent)

	// Create existing resource
	existing := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &commonspb.ApiResourceMetadata{
			Id:   "existing-id",
			Name: "my-agent",
			Slug: "my-agent",
		},
		Spec: &agentv1.AgentSpec{
			Description: "Existing",
		},
	}
	store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, "existing-id", existing)

	// Create input
	input := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &commonspb.ApiResourceMetadata{
			Name: "my-agent", // Same slug
		},
		Spec: &agentv1.AgentSpec{
			Description: "Updated",
		},
	}

	// Build pipeline with ResolveSlug + LoadForApply
	reqCtx := pipeline.NewRequestContext(ctx, input)
	reqCtx.SetNewState(input)
	p := pipeline.NewPipeline[*agentv1.Agent]("test-apply").
		AddStep(NewResolveSlugStep[*agentv1.Agent]()).
		AddStep(NewLoadForApplyStep[*agentv1.Agent](store)).
		Build()

	// Execute
	err := p.Execute(reqCtx)

	// Assert
	if err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}
	
	if reqCtx.Get(ShouldCreateKey) != false {
		t.Errorf("Expected shouldCreate=false (UPDATE)")
	}
	
	if input.GetMetadata().GetId() != "existing-id" {
		t.Errorf("Expected ID to be 'existing-id', got %q", input.GetMetadata().GetId())
	}
}
