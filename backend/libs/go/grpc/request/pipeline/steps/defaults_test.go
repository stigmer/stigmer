package steps

import (
	"context"
	"fmt"
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
// for stigmer/stigmer#453 (creation identity) and stigmer/stigmer#540
// (slot granularity): the helper used to rebuild the whole audit block,
// resetting created_by/created_at to system/now AND stamping both slots
// on every targeted mutation.
//
// The pinned contract: the named slot keeps created_by/created_at EXACTLY
// (full proto equality; spec_audit and status_audit each keep their own)
// and gets a fresh update stamp; the other slot is proto.Equal to before.
func TestSetAuditFieldsForUpdate_PreservesCreationAudit(t *testing.T) {
	for _, tc := range []struct {
		name AuditSlot
	}{
		{name: SpecAudit},
		{name: StatusAudit},
	} {
		t.Run(tc.name.fieldNameForTest(), func(t *testing.T) {
			agent := surgicalAuditFixture()
			beforeSpec := proto.Clone(agent.Status.Audit.SpecAudit).(*apiresource.ApiResourceAuditInfo)
			beforeStatus := proto.Clone(agent.Status.Audit.StatusAudit).(*apiresource.ApiResourceAuditInfo)

			before := time.Now()
			if err := SetAuditFieldsForUpdate(agent, tc.name); err != nil {
				t.Fatalf("Expected success, got error: %v", err)
			}

			audit := agent.GetStatus().GetAudit()
			if audit == nil || audit.SpecAudit == nil || audit.StatusAudit == nil {
				t.Fatalf("Expected both audit slots to remain set, got %v", audit)
			}

			var stamped, other *apiresource.ApiResourceAuditInfo
			var otherBefore *apiresource.ApiResourceAuditInfo
			switch tc.name {
			case SpecAudit:
				stamped, other, otherBefore = audit.SpecAudit, audit.StatusAudit, beforeStatus
			case StatusAudit:
				stamped, other, otherBefore = audit.StatusAudit, audit.SpecAudit, beforeSpec
			}

			if !proto.Equal(other, otherBefore) {
				t.Errorf("untouched slot mutated: want %v, got %v", otherBefore, other)
			}

			if tc.name == SpecAudit {
				if !proto.Equal(stamped.CreatedBy, beforeSpec.CreatedBy) {
					t.Errorf("spec_audit.created_by not preserved: want %v, got %v", beforeSpec.CreatedBy, stamped.CreatedBy)
				}
				if !proto.Equal(stamped.CreatedAt, beforeSpec.CreatedAt) {
					t.Errorf("spec_audit.created_at not preserved: want %v, got %v", beforeSpec.CreatedAt, stamped.CreatedAt)
				}
			} else {
				if !proto.Equal(stamped.CreatedBy, beforeStatus.CreatedBy) {
					t.Errorf("status_audit.created_by not preserved: want %v, got %v", beforeStatus.CreatedBy, stamped.CreatedBy)
				}
				if !proto.Equal(stamped.CreatedAt, beforeStatus.CreatedAt) {
					t.Errorf("status_audit.created_at not preserved: want %v, got %v", beforeStatus.CreatedAt, stamped.CreatedAt)
				}
			}

			if stamped.UpdatedAt.AsTime().Before(before) {
				t.Errorf("updated_at not stamped fresh: got %v, want >= %v", stamped.UpdatedAt.AsTime(), before)
			}
			if stamped.UpdatedBy.GetId() != "system" {
				t.Errorf("updated_by not stamped: want system, got %q", stamped.UpdatedBy.GetId())
			}
			if stamped.Event != "updated" {
				t.Errorf("event: want updated, got %q", stamped.Event)
			}
		})
	}
}

// TestSetAuditFieldsForUpdate_NoPriorAudit pins the first-write fallback:
// a resource with no existing audit gets creation fields backfilled on
// the stamped slot only — the other slot is not invented.
func TestSetAuditFieldsForUpdate_NoPriorAudit(t *testing.T) {
	for _, slot := range []AuditSlot{SpecAudit, StatusAudit} {
		t.Run(slot.fieldNameForTest(), func(t *testing.T) {
			agent := &agentv1.Agent{
				Metadata: &apiresource.ApiResourceMetadata{Name: "Test Agent"},
				Status:   &agentv1.AgentStatus{},
			}

			if err := SetAuditFieldsForUpdate(agent, slot); err != nil {
				t.Fatalf("Expected success, got error: %v", err)
			}

			audit := agent.GetStatus().GetAudit()
			if audit == nil {
				t.Fatal("Expected audit wrapper to be created")
			}

			var stamped, other *apiresource.ApiResourceAuditInfo
			if slot == SpecAudit {
				stamped, other = audit.SpecAudit, audit.StatusAudit
			} else {
				stamped, other = audit.StatusAudit, audit.SpecAudit
			}

			if other != nil {
				t.Errorf("first-write must not invent the other slot, got %v", other)
			}
			if stamped == nil {
				t.Fatal("expected stamped slot to be filled")
			}
			if stamped.CreatedAt == nil || stamped.CreatedBy == nil {
				t.Fatalf("expected creation fallback to be filled, got created_by=%v created_at=%v", stamped.CreatedBy, stamped.CreatedAt)
			}
			if !proto.Equal(stamped.CreatedAt, stamped.UpdatedAt) {
				t.Errorf("fallback created_at should equal updated_at, got %v vs %v", stamped.CreatedAt, stamped.UpdatedAt)
			}
			if stamped.CreatedBy.GetId() != "system" {
				t.Errorf("fallback created_by should be system, got %q", stamped.CreatedBy.GetId())
			}
			if stamped.Event != "updated" {
				t.Errorf("event: want updated, got %q", stamped.Event)
			}
		})
	}
}

// TestSetAuditFieldsForUpdate_InvalidSlot rejects the zero value so a
// missing argument cannot silently default to a slot.
func TestSetAuditFieldsForUpdate_InvalidSlot(t *testing.T) {
	agent := surgicalAuditFixture()
	if err := SetAuditFieldsForUpdate(agent, 0); err == nil {
		t.Fatal("expected error for zero AuditSlot")
	}
}

// TestSetAuditFieldsForUpdate_DoesNotMutateSharedSlotPointers pins the
// skill-push pointer-copy hazard: callers copy SpecAudit/StatusAudit
// pointers from the loaded resource onto a new wrapper. The helper must
// Set a newly allocated slot message; in-place mutation would corrupt
// the in-memory original.
func TestSetAuditFieldsForUpdate_DoesNotMutateSharedSlotPointers(t *testing.T) {
	existing := surgicalAuditFixture()
	originalSpec := proto.Clone(existing.Status.Audit.SpecAudit).(*apiresource.ApiResourceAuditInfo)
	originalStatus := proto.Clone(existing.Status.Audit.StatusAudit).(*apiresource.ApiResourceAuditInfo)

	updated := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Test Agent"},
		Status: &agentv1.AgentStatus{
			Audit: &apiresource.ApiResourceAudit{
				SpecAudit:   existing.Status.Audit.SpecAudit,
				StatusAudit: existing.Status.Audit.StatusAudit,
			},
		},
	}

	if err := SetAuditFieldsForUpdate(updated, SpecAudit); err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}

	if !proto.Equal(existing.Status.Audit.SpecAudit, originalSpec) {
		t.Errorf("shared spec_audit pointer on the in-memory original was mutated")
	}
	if !proto.Equal(existing.Status.Audit.StatusAudit, originalStatus) {
		t.Errorf("shared status_audit pointer on the in-memory original was mutated")
	}
	if proto.Equal(updated.Status.Audit.SpecAudit, existing.Status.Audit.SpecAudit) {
		t.Errorf("updated spec_audit still sharing the original slot message")
	}
	if updated.Status.Audit.StatusAudit != existing.Status.Audit.StatusAudit {
		t.Errorf("untouched status slot should still be the shared pointer")
	}
}

func surgicalAuditFixture() *agentv1.Agent {
	specCreatedBy := &apiresource.ApiResourceAuditActor{Id: "user-alice"}
	specCreatedAt := timestamppb.New(time.Date(2024, 3, 15, 10, 30, 0, 123456789, time.UTC))
	statusCreatedBy := &apiresource.ApiResourceAuditActor{Id: "user-bob"}
	statusCreatedAt := timestamppb.New(time.Date(2024, 6, 1, 8, 0, 0, 987654321, time.UTC))
	staleUpdatedAt := timestamppb.New(time.Date(2024, 7, 4, 12, 0, 0, 0, time.UTC))
	return &agentv1.Agent{
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
}

func (s AuditSlot) fieldNameForTest() string {
	name, err := s.fieldName()
	if err != nil {
		return fmt.Sprintf("invalid(%d)", int(s))
	}
	return string(name)
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

// withOperatorIdentity installs an operator identity for the test and
// restores the unconfigured default afterward, so the suite's "system"
// fallback pins stay order-independent.
func withOperatorIdentity(t *testing.T, email, name string) {
	t.Helper()
	SetOperatorIdentity(email, name)
	t.Cleanup(func() { SetOperatorIdentity("", "") })
}

// TestOperatorIdentity_CreateStampsConfiguredActor pins the configured-
// operator contract (stigmer/stigmer#400): with SetOperatorIdentity
// installed, creates stamp a real actor — id AND email carry the address
// (email-in-id is the sanctioned local mix; downstream caller-identity
// resolution is email-first), display_name carries the configured name —
// which is what makes MCP servers see stigmer_user/<email> instead of the
// anonymous demotion of the "system" placeholder.
func TestOperatorIdentity_CreateStampsConfiguredActor(t *testing.T) {
	withOperatorIdentity(t, "ada@example.com", "Ada Lovelace")

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Test Agent"},
		Status:   &agentv1.AgentStatus{},
	}
	if err := SetAuditFieldsForCreate(agent); err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}

	want := &apiresource.ApiResourceAuditActor{
		Id:          "ada@example.com",
		Email:       "ada@example.com",
		DisplayName: "Ada Lovelace",
	}
	audit := agent.GetStatus().GetAudit()
	for slot, info := range map[string]*apiresource.ApiResourceAuditInfo{
		"spec_audit":   audit.GetSpecAudit(),
		"status_audit": audit.GetStatusAudit(),
	} {
		if !proto.Equal(info.GetCreatedBy(), want) {
			t.Errorf("%s created_by: want operator actor, got %v", slot, info.GetCreatedBy())
		}
		if !proto.Equal(info.GetUpdatedBy(), want) {
			t.Errorf("%s updated_by: want operator actor, got %v", slot, info.GetUpdatedBy())
		}
	}
}

// TestOperatorIdentity_UpdateStampsConfiguredActor pins the update half:
// a targeted mutation's updated_by carries the operator while the slot's
// creation identity is preserved untouched.
func TestOperatorIdentity_UpdateStampsConfiguredActor(t *testing.T) {
	withOperatorIdentity(t, "ada@example.com", "")

	agent := surgicalAuditFixture()
	if err := SetAuditFieldsForUpdate(agent, SpecAudit); err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}

	spec := agent.GetStatus().GetAudit().GetSpecAudit()
	if spec.GetUpdatedBy().GetId() != "ada@example.com" || spec.GetUpdatedBy().GetEmail() != "ada@example.com" {
		t.Errorf("updated_by should carry the operator, got %v", spec.GetUpdatedBy())
	}
	if spec.GetUpdatedBy().GetDisplayName() != "" {
		t.Errorf("display_name should stay empty when not configured, got %q", spec.GetUpdatedBy().GetDisplayName())
	}
	if spec.GetCreatedBy().GetId() != "user-alice" {
		t.Errorf("created_by must be preserved, got %v", spec.GetCreatedBy())
	}
}

// TestOperatorIdentity_ActorsDoNotAlias pins that currentAuditActor builds a
// fresh message per call: audit stamping shares the returned pointer across
// a resource's own created_by/updated_by, so a package-level singleton would
// alias unrelated resources' audit state through later mutation.
func TestOperatorIdentity_ActorsDoNotAlias(t *testing.T) {
	withOperatorIdentity(t, "ada@example.com", "Ada Lovelace")

	first := currentAuditActor()
	second := currentAuditActor()
	if first == second {
		t.Fatalf("currentAuditActor must return a fresh message per call")
	}
	first.DisplayName = "Mutated"
	if second.DisplayName != "Ada Lovelace" {
		t.Errorf("mutating one returned actor leaked into another: %v", second)
	}
}

// TestOperatorIdentity_UnsetKeepsSystemPlaceholder pins the round-trip: after
// clearing the operator identity, the historical "system" placeholder is
// stamped again — the unconfigured contract the runner's caller-identity
// resolution demotes to anonymous (deny-by-default for self-hosted installs).
func TestOperatorIdentity_UnsetKeepsSystemPlaceholder(t *testing.T) {
	SetOperatorIdentity("ada@example.com", "Ada Lovelace")
	SetOperatorIdentity("", "")

	actor := currentAuditActor()
	if actor.GetId() != "system" || actor.GetEmail() != "" || actor.GetDisplayName() != "" {
		t.Errorf("unconfigured actor must be the bare system placeholder, got %v", actor)
	}
}
