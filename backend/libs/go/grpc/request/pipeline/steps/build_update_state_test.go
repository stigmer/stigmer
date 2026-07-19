package steps

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
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
			Id:   "agent-999",     // Different ID - should be preserved from existing
			Name: "updated-agent", // Different name - should be updated (name is mutable)
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

	// Check that name was updated from input (name is mutable, not preserved)
	if updated.Metadata.Name != "updated-agent" {
		t.Errorf("Expected name to be updated to %q, got %q", "updated-agent", updated.Metadata.Name)
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

// Visibility must survive a full update that omits it (proto zero value),
// mirroring Java's UpdateOperationPreserveResourceIdentifiersStepV2. Console
// inline edits and manifests without metadata.visibility send unspecified;
// without the preserve-on-omit guard they would silently reset the stored
// visibility. An update that explicitly carries a level must still apply it.
func TestBuildUpdateStateStep_VisibilityPreservedWhenOmitted(t *testing.T) {
	tests := []struct {
		name            string
		inputVisibility apiresource.ApiResourceVisibility
		wantVisibility  apiresource.ApiResourceVisibility
	}{
		{
			name:            "omitted visibility preserves existing",
			inputVisibility: apiresource.ApiResourceVisibility_api_resource_visibility_unspecified,
			wantVisibility:  apiresource.ApiResourceVisibility_visibility_org,
		},
		{
			name:            "explicit visibility is applied",
			inputVisibility: apiresource.ApiResourceVisibility_visibility_private,
			wantVisibility:  apiresource.ApiResourceVisibility_visibility_private,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			existing := &agentv1.Agent{
				Metadata: &apiresource.ApiResourceMetadata{
					Id:         "agent-123",
					Name:       "existing-agent",
					Visibility: apiresource.ApiResourceVisibility_visibility_org,
				},
				Spec: &agentv1.AgentSpec{
					Description: "Original description",
				},
			}

			// An unrelated-field edit: only the description changes.
			input := &agentv1.Agent{
				Metadata: &apiresource.ApiResourceMetadata{
					Id:         "agent-123",
					Name:       "existing-agent",
					Visibility: tt.inputVisibility,
				},
				Spec: &agentv1.AgentSpec{
					Description: "Updated description",
				},
			}

			ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)
			ctx.Set(ExistingResourceKey, existing)

			step := NewBuildUpdateStateStep[*agentv1.Agent]()
			if err := step.Execute(ctx); err != nil {
				t.Fatalf("Expected success, got error: %v", err)
			}

			updated := ctx.NewState()
			if updated.Metadata.Visibility != tt.wantVisibility {
				t.Errorf("Expected visibility %v, got %v",
					tt.wantVisibility, updated.Metadata.Visibility)
			}
			if updated.Spec.Description != "Updated description" {
				t.Errorf("Expected description to be updated, got %q", updated.Spec.Description)
			}
		})
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
