package steps

import (
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	commonspb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// BuildUpdateStateStep builds the new state for a resource during update
//
// This step performs the following operations (aligned with Java's UpdateOperationBuildNewStateStepV2):
//  1. Load existing resource from context (set by LoadExistingStep)
//  2. Merge spec from input to existing resource
//  3. Preserve metadata.id and other immutable fields
//  4. Clear status field (status is system-managed, not client-modifiable)
//  5. Clear computed fields (TODO: when needed)
//  6. Update audit fields in status.audit:
//     - Preserve created_by and created_at from existing
//     - Update updated_by (actor)
//     - Update updated_at (timestamp)
//     - Set event to "updated"
//     - spec_audit.updated_by and spec_audit.updated_at are updated
//     - status_audit is reset (status was cleared)
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

	// 4. Clear status field
	// Status is system-managed and should not contain any client-provided data
	statusResource, hasStatus := any(merged).(HasStatus)
	if hasStatus {
		if err := clearStatusField(statusResource); err != nil {
			return fmt.Errorf("failed to clear status field: %w", err)
		}
	}

	// 5. TODO: Clear computed fields (when we have computed fields)

	// 6. Update audit fields in status
	if hasStatus {
		if err := updateAuditFields(statusResource, existing, ctx); err != nil {
			return fmt.Errorf("failed to update audit fields: %w", err)
		}
	}

	// Set the merged resource as the new state
	ctx.SetNewState(merged)

	return nil
}

// preserveImmutableFields copies immutable fields from existing to merged resource
//
// Immutable fields include:
// - metadata.id (cannot be changed)
// - metadata.name (slug - cannot be changed once set)
// - metadata.created_at (set during creation)
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

	// Preserve immutable fields
	mergedMeta.Id = existingMeta.Id
	mergedMeta.Name = existingMeta.Name // Slug is immutable

	// Note: Other metadata fields (title, description, labels, tags) are mutable
	// and can be updated by the client

	return nil
}

// updateAuditFields updates the audit information in the status field for update operations
//
// For update operations:
// - spec_audit.created_by and created_at are preserved from existing
// - spec_audit.updated_by and updated_at are set to current actor/timestamp
// - status_audit.created_by and created_at are set to current (status was reset)
// - status_audit.updated_by and updated_at are set to current
// - event is set to "updated"
//
// This function uses proto reflection to set the audit field generically.
func updateAuditFields[T proto.Message](resource HasStatus, existing T, ctx *pipeline.RequestContext[T]) error {
	status := resource.GetStatus()
	if status == nil {
		return fmt.Errorf("status is nil")
	}

	// Get current timestamp
	now := timestamppb.Now()

	// Build audit actor
	// TODO: Get actual caller information from auth context when auth is implemented
	// For now, use system/local placeholder
	actor := &commonspb.ApiResourceAuditActor{
		Id:     "system",
		Avatar: "",
	}

	// Extract existing audit info to preserve created_by and created_at for spec_audit
	var existingCreatedBy *commonspb.ApiResourceAuditActor
	var existingCreatedAt *timestamppb.Timestamp

	// Try to get existing audit info
	existingStatus, hasExistingStatus := any(existing).(HasStatus)
	if hasExistingStatus && existingStatus.GetStatus() != nil {
		existingStatusMsg := existingStatus.GetStatus().ProtoReflect()
		existingAuditField := existingStatusMsg.Descriptor().Fields().ByName("audit")
		if existingAuditField != nil && existingStatusMsg.Has(existingAuditField) {
			existingAuditMsg := existingStatusMsg.Get(existingAuditField).Message()
			
			// Get spec_audit
			specAuditField := existingAuditMsg.Descriptor().Fields().ByName("spec_audit")
			if specAuditField != nil && existingAuditMsg.Has(specAuditField) {
				specAuditMsg := existingAuditMsg.Get(specAuditField).Message()
				
				// Get created_by
				createdByField := specAuditMsg.Descriptor().Fields().ByName("created_by")
				if createdByField != nil && specAuditMsg.Has(createdByField) {
					existingCreatedBy = &commonspb.ApiResourceAuditActor{}
					proto.Merge(existingCreatedBy, specAuditMsg.Get(createdByField).Message().Interface())
				}
				
				// Get created_at
				createdAtField := specAuditMsg.Descriptor().Fields().ByName("created_at")
				if createdAtField != nil && specAuditMsg.Has(createdAtField) {
					existingCreatedAt = &timestamppb.Timestamp{}
					proto.Merge(existingCreatedAt, specAuditMsg.Get(createdAtField).Message().Interface())
				}
			}
		}
	}

	// Fallback to current actor/time if existing audit not found
	if existingCreatedBy == nil {
		existingCreatedBy = actor
	}
	if existingCreatedAt == nil {
		existingCreatedAt = now
	}

	// Build spec_audit - preserve created info, update updated info
	specAuditInfo := &commonspb.ApiResourceAuditInfo{
		CreatedBy: existingCreatedBy,
		CreatedAt: existingCreatedAt,
		UpdatedBy: actor,
		UpdatedAt: now,
		Event:     "updated",
	}

	// Build status_audit - status was reset, so both created and updated are current
	statusAuditInfo := &commonspb.ApiResourceAuditInfo{
		CreatedBy: actor,
		CreatedAt: now,
		UpdatedBy: actor,
		UpdatedAt: now,
		Event:     "updated",
	}

	// Build complete audit
	audit := &commonspb.ApiResourceAudit{
		SpecAudit:   specAuditInfo,
		StatusAudit: statusAuditInfo,
	}

	// Set audit field using proto reflection
	statusMsg := status.ProtoReflect()
	auditField := statusMsg.Descriptor().Fields().ByName("audit")
	if auditField == nil {
		// Status doesn't have an audit field - this is ok, not all resources may have audit
		return nil
	}

	statusMsg.Set(auditField, protoreflect.ValueOfMessage(audit.ProtoReflect()))
	return nil
}
