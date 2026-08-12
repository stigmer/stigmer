package steps

import (
	"context"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
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

	// Check ID format (should start with "agt_" for agent kind)
	if !strings.HasPrefix(agent.Metadata.Id, "agt_") {
		t.Errorf("Expected ID to start with 'agt_', got %q", agent.Metadata.Id)
	}

	// Check ID has prefix_ulid format
	parts := strings.SplitN(agent.Metadata.Id, "_", 2)
	if len(parts) != 2 {
		t.Errorf("Expected ID format 'agt_{ulid}', got %q", agent.Metadata.Id)
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
	existingID := "agt_123456789"
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
		{"agent kind", apiresourcekind.ApiResourceKind_agent, "agt_"},
		{"workflow kind", apiresourcekind.ApiResourceKind_workflow, "wfl_"},
		{"agent_instance kind", apiresourcekind.ApiResourceKind_agent_instance, "ain_"},
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

// TestBuildNewStateStep_DefaultVisibility pins the create-time visibility
// default: blueprint kinds flagged defaults_to_org_visibility persist
// visibility_org, every other kind persists visibility_private — never the
// proto zero value. This is the OSS half of the cross-edition contract
// asserted end-to-end by TestVisibilityCreateDefaults (test/integration,
// Java service) and the per-kind create pins in test/conformance.
//
// The agent proto is reused across kinds deliberately (the same trick as
// TestBuildNewStateStep_DifferentKinds): the step is generic and visibility
// lives on the shared ApiResourceMetadata, so only the kind in context
// matters.
func TestBuildNewStateStep_DefaultVisibility(t *testing.T) {
	tests := []struct {
		name     string
		kind     apiresourcekind.ApiResourceKind
		expected apiresource.ApiResourceVisibility
	}{
		{"agent (blueprint) defaults to org", apiresourcekind.ApiResourceKind_agent, apiresource.ApiResourceVisibility_visibility_org},
		{"workflow (blueprint) defaults to org", apiresourcekind.ApiResourceKind_workflow, apiresource.ApiResourceVisibility_visibility_org},
		{"mcp_server (blueprint) defaults to org", apiresourcekind.ApiResourceKind_mcp_server, apiresource.ApiResourceVisibility_visibility_org},
		{"agent_instance (non-blueprint) defaults to private", apiresourcekind.ApiResourceKind_agent_instance, apiresource.ApiResourceVisibility_visibility_private},
		{"session (non-blueprint) defaults to private", apiresourcekind.ApiResourceKind_session, apiresource.ApiResourceVisibility_visibility_private},
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

			if err := step.Execute(ctx); err != nil {
				t.Fatalf("Expected success, got error: %v", err)
			}

			if agent.Metadata.Visibility != tt.expected {
				t.Errorf("Expected visibility %v, got %v", tt.expected, agent.Metadata.Visibility)
			}
		})
	}
}

// TestBuildNewStateStep_ExplicitVisibilityPreserved pins that the default is
// strictly an unspecified-only fill: a client-chosen level is never
// overwritten, even when it differs from the kind's default.
func TestBuildNewStateStep_ExplicitVisibilityPreserved(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       "Test",
			Visibility: apiresource.ApiResourceVisibility_visibility_public,
		},
	}

	step := NewBuildNewStateStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}

	if agent.Metadata.Visibility != apiresource.ApiResourceVisibility_visibility_public {
		t.Errorf("Expected explicit visibility_public to be preserved, got %v", agent.Metadata.Visibility)
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
		{"agt", "agt_"},
		{"wfl", "wfl_"},
		{"ain", "ain_"},
	}

	for _, tt := range tests {
		t.Run(tt.prefix, func(t *testing.T) {
			id := generateID(tt.prefix)

			if !strings.HasPrefix(id, tt.expected) {
				t.Errorf("generateID(%q) should start with %q, got %q", tt.prefix, tt.expected, id)
			}

			parts := strings.SplitN(id, "_", 2)
			if len(parts) != 2 {
				t.Errorf("Expected ID format '{prefix}_{ulid}', got %q", id)
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

// TestSetAuditFieldsForUpdate_PreservesCreationAudit is the regression pin
// for stigmer/stigmer#453: the helper used to rebuild the whole audit
// block, resetting created_by/created_at to system/now on every call —
// silently destroying the true creation record at all 14 call sites
// (visibility flips, skill push, schedule stamps, artifact soft-delete,
// share-link rotate) and reordering every created_at-sorted list.
//
// The pinned contract: created_by/created_at survive EXACTLY (full proto
// equality, per audit slot — spec_audit and status_audit each keep their
// own), updated_by/updated_at are stamped fresh, event flips to "updated".
func TestSetAuditFieldsForUpdate_PreservesCreationAudit(t *testing.T) {
	// Distinct creation identities per slot prove per-slot extraction —
	// a fix that copied spec_audit's values into status_audit would fail.
	specCreatedBy := &apiresource.ApiResourceAuditActor{Id: "user-alice"}
	specCreatedAt := timestamppb.New(time.Date(2024, 3, 15, 10, 30, 0, 123456789, time.UTC))
	statusCreatedBy := &apiresource.ApiResourceAuditActor{Id: "user-bob"}
	statusCreatedAt := timestamppb.New(time.Date(2024, 6, 1, 8, 0, 0, 987654321, time.UTC))
	staleUpdatedAt := timestamppb.New(time.Date(2024, 7, 4, 12, 0, 0, 0, time.UTC))

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Test Agent"},
		Status: &agentv1.AgentStatus{
			Audit: &apiresource.ApiResourceAudit{
				SpecAudit: &apiresource.ApiResourceAuditInfo{
					CreatedBy: specCreatedBy,
					CreatedAt: specCreatedAt,
					UpdatedBy: specCreatedBy,
					UpdatedAt: staleUpdatedAt,
					Event:     "created",
				},
				StatusAudit: &apiresource.ApiResourceAuditInfo{
					CreatedBy: statusCreatedBy,
					CreatedAt: statusCreatedAt,
					UpdatedBy: statusCreatedBy,
					UpdatedAt: staleUpdatedAt,
					Event:     "created",
				},
			},
		},
	}

	before := time.Now()
	if err := SetAuditFieldsForUpdate(agent); err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}

	audit := agent.GetStatus().GetAudit()
	if audit == nil || audit.SpecAudit == nil || audit.StatusAudit == nil {
		t.Fatalf("Expected both audit slots to be set, got %v", audit)
	}

	// Creation identity preserved exactly, per slot.
	if !proto.Equal(audit.SpecAudit.CreatedBy, specCreatedBy) {
		t.Errorf("spec_audit.created_by not preserved: want %v, got %v", specCreatedBy, audit.SpecAudit.CreatedBy)
	}
	if !proto.Equal(audit.SpecAudit.CreatedAt, specCreatedAt) {
		t.Errorf("spec_audit.created_at not preserved: want %v, got %v", specCreatedAt, audit.SpecAudit.CreatedAt)
	}
	if !proto.Equal(audit.StatusAudit.CreatedBy, statusCreatedBy) {
		t.Errorf("status_audit.created_by not preserved: want %v, got %v", statusCreatedBy, audit.StatusAudit.CreatedBy)
	}
	if !proto.Equal(audit.StatusAudit.CreatedAt, statusCreatedAt) {
		t.Errorf("status_audit.created_at not preserved: want %v, got %v", statusCreatedAt, audit.StatusAudit.CreatedAt)
	}

	// Update stamp is fresh on both slots.
	for slot, info := range map[string]*apiresource.ApiResourceAuditInfo{
		"spec_audit":   audit.SpecAudit,
		"status_audit": audit.StatusAudit,
	} {
		if info.UpdatedAt.AsTime().Before(before) {
			t.Errorf("%s.updated_at not stamped fresh: got %v, want >= %v", slot, info.UpdatedAt.AsTime(), before)
		}
		if info.UpdatedBy.GetId() != "system" {
			t.Errorf("%s.updated_by not stamped: want system, got %q", slot, info.UpdatedBy.GetId())
		}
		if info.Event != "updated" {
			t.Errorf("%s.event: want updated, got %q", slot, info.Event)
		}
	}
}

// TestSetAuditFieldsForUpdate_NoPriorAudit pins the first-write fallback:
// a resource with no existing audit gets creation fields backfilled with
// the current actor/time — the same fallback BuildUpdateStateStep uses —
// instead of nil creation fields or an error.
func TestSetAuditFieldsForUpdate_NoPriorAudit(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Test Agent"},
		Status:   &agentv1.AgentStatus{},
	}

	if err := SetAuditFieldsForUpdate(agent); err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}

	audit := agent.GetStatus().GetAudit()
	if audit == nil || audit.SpecAudit == nil || audit.StatusAudit == nil {
		t.Fatalf("Expected both audit slots to be set, got %v", audit)
	}

	for slot, info := range map[string]*apiresource.ApiResourceAuditInfo{
		"spec_audit":   audit.SpecAudit,
		"status_audit": audit.StatusAudit,
	} {
		if info.CreatedAt == nil || info.CreatedBy == nil {
			t.Fatalf("%s: expected creation fallback to be filled, got created_by=%v created_at=%v", slot, info.CreatedBy, info.CreatedAt)
		}
		// The fallback backfills creation with the same stamp as the update.
		if !proto.Equal(info.CreatedAt, info.UpdatedAt) {
			t.Errorf("%s: fallback created_at should equal updated_at, got %v vs %v", slot, info.CreatedAt, info.UpdatedAt)
		}
		if info.CreatedBy.GetId() != "system" {
			t.Errorf("%s: fallback created_by should be system, got %q", slot, info.CreatedBy.GetId())
		}
		if info.Event != "updated" {
			t.Errorf("%s.event: want updated, got %q", slot, info.Event)
		}
	}
}

// TestSetAuditFieldsForCreate pins the create stamp: both audit slots set
// identically, created == updated, event "created".
func TestSetAuditFieldsForCreate(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Test Agent"},
		Status:   &agentv1.AgentStatus{},
	}

	if err := SetAuditFieldsForCreate(agent); err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}

	audit := agent.GetStatus().GetAudit()
	if audit == nil || audit.SpecAudit == nil || audit.StatusAudit == nil {
		t.Fatalf("Expected both audit slots to be set, got %v", audit)
	}
	if !proto.Equal(audit.SpecAudit, audit.StatusAudit) {
		t.Errorf("Expected spec_audit and status_audit to be identical on create, got %v vs %v", audit.SpecAudit, audit.StatusAudit)
	}
	if !proto.Equal(audit.SpecAudit.CreatedAt, audit.SpecAudit.UpdatedAt) {
		t.Errorf("Expected created_at == updated_at on create, got %v vs %v", audit.SpecAudit.CreatedAt, audit.SpecAudit.UpdatedAt)
	}
	if audit.SpecAudit.Event != "created" {
		t.Errorf("Expected event=created, got %q", audit.SpecAudit.Event)
	}
}
