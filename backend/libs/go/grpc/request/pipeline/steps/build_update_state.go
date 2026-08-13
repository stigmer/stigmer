package steps

import (
	"fmt"

	commonspb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// BuildUpdateStateStep builds the new state for a resource during update
//
// This step performs the following operations (aligned with Java's UpdateOperationBuildNewStateStepV2):
//  1. Load existing resource from context (set by LoadExistingStep)
//  2. Merge spec from input to existing resource
//  3. Preserve metadata.id and other immutable fields
//  4. Clear status field from INPUT (status is system-managed, not client-modifiable)
//  5. Preserve ENTIRE status from existing resource (all system state: default_instance_id, phase, conditions, etc.)
//  6. Update ONLY audit fields within the preserved status:
//     - Preserve created_by and created_at from existing
//     - Update updated_by (actor)
//     - Update updated_at (timestamp)
//     - Set event to "updated"
//
// The api_resource_kind is extracted from request context (injected by interceptor).
type BuildUpdateStateStep[T proto.Message] struct {
}

// NewBuildUpdateStateStep creates a new BuildUpdateStateStep
//
// The api_resource_kind is automatically extracted from the request context
// by the apiresource interceptor during request handling.
func NewBuildUpdateStateStep[T proto.Message]() *BuildUpdateStateStep[T] {
	return &BuildUpdateStateStep[T]{}
}

// Name returns the step name
func (s *BuildUpdateStateStep[T]) Name() string {
	return "BuildUpdateState"
}

// Execute builds the updated state for the resource
func (s *BuildUpdateStateStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	input := ctx.Input()

	// 1. Load existing resource from context
	existingVal := ctx.Get(ExistingResourceKey)
	if existingVal == nil {
		return fmt.Errorf("existing resource not found in context - LoadExistingStep must run first")
	}

	existing, ok := existingVal.(T)
	if !ok {
		return fmt.Errorf("existing resource in context has wrong type")
	}

	// 2. Merge spec from input to existing
	// Strategy: Full spec replacement (input spec overwrites existing spec)
	// This is the common pattern - client sends complete desired state
	merged := proto.Clone(input).(T)

	// 3. Preserve immutable metadata fields from existing
	if err := preserveImmutableFields(merged, existing); err != nil {
		return fmt.Errorf("failed to preserve immutable fields: %w", err)
	}

	// 4. Clear status field using proto reflection
	// Status is system-managed and should not contain any client-provided data from request
	if hasStatusField(merged) {
		if err := clearStatusFieldReflect(merged); err != nil {
			return fmt.Errorf("failed to clear status field: %w", err)
		}
	}

	// 5. Preserve entire status from existing resource (matching Java ApiResourcePreviousStatusReplacer.replace)
	// This preserves ALL system-managed status fields (default_instance_id, phase, etc.)
	if err := copyStatusFromExisting(merged, existing); err != nil {
		return fmt.Errorf("failed to copy status from existing: %w", err)
	}

	// 6. Update audit fields in status using proto reflection
	// This updates ONLY audit info within the preserved status
	if hasStatusField(merged) {
		if err := updateAuditFieldsReflect(merged, existing); err != nil {
			return fmt.Errorf("failed to update audit fields: %w", err)
		}
	}

	// Set the merged resource as the new state
	ctx.SetNewState(merged)

	return nil
}

// preserveImmutableFields copies immutable fields from existing to merged resource
//
// Update-immutable fields (matching Java UpdateOperationPreserveResourceIdentifiersStepV2):
//   - metadata.id (resource ID - cannot be changed)
//   - metadata.slug (URL-safe identifier - cannot be changed once set)
//   - metadata.org (organization - cannot be changed once set)
//   - metadata.visibility - the updateVisibility RPC is the ONLY door for
//     visibility changes (oss#573). Every visibility guard — the per-kind
//     level-support check (oss#489) and the default-instance rejection
//     (oss#556) — lives on the updateVisibility pipelines, so a plain
//     Update that changed the level would bypass all of them (and, on
//     cloud, either grant/revoke real FGA access unvalidated or drift the
//     stored enum away from FGA). Preserving unconditionally makes the
//     bypass structurally impossible; declarative clients (CLI apply, MCP
//     apply tools) diff and follow up with updateVisibility instead.
//
// Mutable fields (NOT preserved, can be updated):
// - metadata.name (display name - CAN be changed)
// - metadata.title, description, labels, tags, etc.
func preserveImmutableFields[T proto.Message](merged, existing T) error {
	// Type assertions to access metadata
	mergedMetadata, ok := any(merged).(HasMetadata)
	if !ok {
		return fmt.Errorf("merged resource does not implement HasMetadata")
	}

	existingMetadata, ok := any(existing).(HasMetadata)
	if !ok {
		return fmt.Errorf("existing resource does not implement HasMetadata")
	}

	mergedMeta := mergedMetadata.GetMetadata()
	existingMeta := existingMetadata.GetMetadata()

	if mergedMeta == nil || existingMeta == nil {
		return fmt.Errorf("metadata is nil")
	}

	// Preserve immutable identifiers (matching Java implementation)
	mergedMeta.Id = existingMeta.Id     // Resource ID (immutable)
	mergedMeta.Slug = existingMeta.Slug // Slug (immutable, derived from original name)
	mergedMeta.Org = existingMeta.Org   // Organization (immutable)

	// Visibility is update-immutable: only the guarded updateVisibility RPC
	// may change it (see the function doc). A request-carried level is
	// deliberately ignored, never rejected — stale manifests re-applied
	// after a console visibility change must not fail the whole update.
	mergedMeta.Visibility = existingMeta.Visibility

	// Note: metadata.name is NOT preserved - it can be updated by the client!
	// Other metadata fields (title, description, labels, tags) are also mutable

	return nil
}

// copyStatusFromExisting copies the entire status field from existing to merged resource
// This matches Java's ApiResourcePreviousStatusReplacer.replace() behavior.
//
// The status field is system-managed and contains all platform state:
// - default_instance_id (for Agent)
// - phase (for executions)
// - conditions (for resources)
// - etc.
//
// During update, we preserve ALL of this state and only update audit fields.
func copyStatusFromExisting[T proto.Message](merged, existing T) error {
	// Get status field from existing resource
	existingMsg := existing.ProtoReflect()
	existingStatusField := existingMsg.Descriptor().Fields().ByName("status")

	if existingStatusField == nil {
		// Resource doesn't have a status field - this is ok
		return nil
	}

	// Check if existing has status set
	if !existingMsg.Has(existingStatusField) {
		// Existing doesn't have status - nothing to copy
		return nil
	}

	// Get the status value from existing
	existingStatus := existingMsg.Get(existingStatusField)

	// Set it on merged
	mergedMsg := merged.ProtoReflect()
	mergedStatusField := mergedMsg.Descriptor().Fields().ByName("status")

	if mergedStatusField == nil {
		// Merged doesn't have status field - this shouldn't happen but handle gracefully
		return nil
	}

	// Copy the entire status field (matching Java: builder.setField(statusFieldDescriptor, previousStatus))
	mergedMsg.Set(mergedStatusField, existingStatus)

	return nil
}

// updateAuditFieldsReflect updates the audit information in the status field for update operations
// using proto reflection to access the status field generically.
//
// For update operations:
// - spec_audit.created_by and created_at are preserved from existing
// - spec_audit.updated_by and updated_at are set to current actor/timestamp
// - status_audit.created_by and created_at are set to current (status was reset)
// - status_audit.updated_by and updated_at are set to current
// - event is set to "updated"
//
// The status field is created if it doesn't exist.
func updateAuditFieldsReflect[T proto.Message](resource T, existing T) error {
	now := timestamppb.Now()
	actor := currentAuditActor()

	// Extract the existing resource's spec_audit creation identity to
	// carry it forward (nil when the existing resource had no audit —
	// updatedAuditInfo falls back to the current actor/time).
	existingCreatedBy, existingCreatedAt := creationAuditOf(existing, "spec_audit")

	return setAuditReflect(resource, &commonspb.ApiResourceAudit{
		// spec_audit - preserve created info, update updated info
		SpecAudit: updatedAuditInfo(existingCreatedBy, existingCreatedAt, actor, now),
		// status_audit - status was reset, so both created and updated are current
		StatusAudit: &commonspb.ApiResourceAuditInfo{
			CreatedBy: actor,
			CreatedAt: now,
			UpdatedBy: actor,
			UpdatedAt: now,
			Event:     "updated",
		},
	})
}
