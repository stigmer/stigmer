package steps

import (
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestBuildUpdateStateStep_Execute(t *testing.T) {
	// Create existing agent with audit info
	existingCreatedAt := timestamppb.Now()
	existingCreatedBy := &apiresource.ApiResourceAuditActor{
		Id:     "user-1",
		Avatar: "avatar-1",
	}

	existing := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-123",
			Name: "existing-agent",
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Original description",
			Instructions: "Original instructions",
		},
		Status: &agentv1.AgentStatus{
			Audit: &apiresource.ApiResourceAudit{
				SpecAudit: &apiresource.ApiResourceAuditInfo{
					CreatedBy: existingCreatedBy,
					CreatedAt: existingCreatedAt,
					UpdatedBy: existingCreatedBy,
					UpdatedAt: existingCreatedAt,
					Event:     "created",
				},
				StatusAudit: &apiresource.ApiResourceAuditInfo{
					CreatedBy: existingCreatedBy,
					CreatedAt: existingCreatedAt,
					UpdatedBy: existingCreatedBy,
					UpdatedAt: existingCreatedAt,
					Event:     "created",
				},
			},
		},
	}

	// Create input agent with updates
	input := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-999", // Different ID - should be preserved from existing
			Name: "updated-agent", // Different name - should be preserved from existing
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Updated description",
			Instructions: "Updated instructions",
		},
	}

	// Setup context with existing resource
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)
	ctx.Set(ExistingResourceKey, existing)

	// Execute BuildUpdateStateStep
	step := NewBuildUpdateStateStep[*agentv1.Agent]()
	err := step.Execute(ctx)

	// Verify
	if err != nil {
		t.Errorf("Expected success, got error: %v", err)
	}

	// Get updated state from context
	updated := ctx.NewState()

	// Check that ID was preserved from existing (not from input)
	if updated.Metadata.Id != "agent-123" {
		t.Errorf("Expected ID to be preserved as %q, got %q", "agent-123", updated.Metadata.Id)
	}

	// Check that name was preserved from existing (not from input)
	if updated.Metadata.Name != "existing-agent" {
		t.Errorf("Expected name to be preserved as %q, got %q", "existing-agent", updated.Metadata.Name)
	}

	// Check that spec was updated from input
	if updated.Spec.Description != "Updated description" {
		t.Errorf("Expected description=%q, got %q", "Updated description", updated.Spec.Description)
	}
	if updated.Spec.Instructions != "Updated instructions" {
		t.Errorf("Expected instructions=%q, got %q", "Updated instructions", updated.Spec.Instructions)
	}

	// Check audit fields
	if updated.Status == nil || updated.Status.Audit == nil {
		t.Fatalf("Expected audit fields to be set")
	}

	// Check spec_audit - created info preserved, updated info changed
	specAudit := updated.Status.Audit.SpecAudit
	if specAudit.CreatedBy.Id != "user-1" {
		t.Errorf("Expected spec_audit.created_by.id to be preserved as %q, got %q", "user-1", specAudit.CreatedBy.Id)
	}
	if specAudit.CreatedAt.AsTime() != existingCreatedAt.AsTime() {
		t.Errorf("Expected spec_audit.created_at to be preserved")
	}
	if specAudit.UpdatedBy.Id != "system" {
		t.Errorf("Expected spec_audit.updated_by.id=%q, got %q", "system", specAudit.UpdatedBy.Id)
	}
	if specAudit.Event != "updated" {
		t.Errorf("Expected spec_audit.event=%q, got %q", "updated", specAudit.Event)
	}

	// Check status_audit - reset to current
	statusAudit := updated.Status.Audit.StatusAudit
	if statusAudit.CreatedBy.Id != "system" {
		t.Errorf("Expected status_audit.created_by.id=%q, got %q", "system", statusAudit.CreatedBy.Id)
	}
	if statusAudit.UpdatedBy.Id != "system" {
		t.Errorf("Expected status_audit.updated_by.id=%q, got %q", "system", statusAudit.UpdatedBy.Id)
	}
	if statusAudit.Event != "updated" {
		t.Errorf("Expected status_audit.event=%q, got %q", "updated", statusAudit.Event)
	}
}

func TestBuildUpdateStateStep_NoExistingInContext(t *testing.T) {
	// Create input without setting existing in context
	input := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-123",
			Name: "test",
		},
	}

	// Setup context WITHOUT existing resource
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)
	// Don't set ExistingResourceKey

	// Execute BuildUpdateStateStep
	step := NewBuildUpdateStateStep[*agentv1.Agent]()
	err := step.Execute(ctx)

	// Should return error - LoadExistingStep must run first
	if err == nil {
		t.Errorf("Expected error when existing resource not in context, got success")
	}
}

func TestBuildUpdateStateStep_NilMetadata(t *testing.T) {
	// Create existing and input with nil metadata
	existing := &agentv1.Agent{
		Metadata: nil,
	}

	input := &agentv1.Agent{
		Metadata: nil,
	}

	// Setup context with existing
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)
	ctx.Set(ExistingResourceKey, existing)

	// Execute BuildUpdateStateStep
	step := NewBuildUpdateStateStep[*agentv1.Agent]()
	err := step.Execute(ctx)

	// Should return error for nil metadata
	if err == nil {
		t.Errorf("Expected error for nil metadata, got success")
	}
}

func TestBuildUpdateStateStep_NoExistingAudit(t *testing.T) {
	// Create existing agent WITHOUT audit info
	existing := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-123",
			Name: "existing-agent",
		},
		Spec: &agentv1.AgentSpec{
			Description: "Existing Agent",
		},
		Status: nil, // No status/audit
	}

	// Create input agent with updates
	input := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-123",
			Name: "updated-agent",
		},
		Spec: &agentv1.AgentSpec{
			Description: "Updated Agent",
		},
	}

	// Setup context with existing resource
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)
	ctx.Set(ExistingResourceKey, existing)

	// Execute BuildUpdateStateStep
	step := NewBuildUpdateStateStep[*agentv1.Agent]()
	err := step.Execute(ctx)

	// Should succeed - audit will be created with defaults
	if err != nil {
		t.Errorf("Expected success, got error: %v", err)
	}

	// Get updated state
	updated := ctx.NewState()

	// Check that audit was created
	if updated.Status == nil || updated.Status.Audit == nil {
		t.Fatalf("Expected audit to be created")
	}

	// Check that created_by/created_at fallback to current (since existing had no audit)
	specAudit := updated.Status.Audit.SpecAudit
	if specAudit.CreatedBy.Id != "system" {
		t.Errorf("Expected spec_audit.created_by.id=%q (fallback), got %q", "system", specAudit.CreatedBy.Id)
	}
}

func TestBuildUpdateStateStep_Name(t *testing.T) {
	step := NewBuildUpdateStateStep[*agentv1.Agent]()
	if step.Name() != "BuildUpdateState" {
		t.Errorf("Expected Name()=BuildUpdateState, got %q", step.Name())
	}
}
