package steps

import (
	"fmt"
	"time"

	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	commonspb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// BuildNewStateStep builds the new state for a resource during creation
//
// This step performs the following operations (aligned with Java's CreateOperationBuildNewStateStepV2):
//   1. Clear status field (status is system-managed, not client-modifiable)
//   2. Clear computed fields (TODO: when needed)
//   3. Set metadata.id: Generated from kind prefix + timestamp (if not set)
//   4. Set version (TODO: when versioning is implemented)
//   5. Set audit fields in status.audit:
//      - created_by (actor)
//      - created_at (timestamp)
//      - updated_by (actor)
//      - updated_at (timestamp)
//      - event (ApiResourceEventType.created)
//      - Both spec_audit and status_audit are set identically for create operations
//
// The step is idempotent - if ID is already set, it will not override it.
//
// The api_resource_kind is extracted from request context (injected by interceptor).
//
// Example:
//
//	For kind=ApiResourceKind_agent
//	Generated ID: "agt-1705678901234567890"
type BuildNewStateStep[T proto.Message] struct {
}

// NewBuildNewStateStep creates a new BuildNewStateStep
//
// The api_resource_kind is automatically extracted from the request context
// by the apiresource interceptor during request handling.
func NewBuildNewStateStep[T proto.Message]() *BuildNewStateStep[T] {
	return &BuildNewStateStep[T]{}
}

// Name returns the step name
func (s *BuildNewStateStep[T]) Name() string {
	return "BuildNewState"
}

// Execute builds the new state for the resource
func (s *BuildNewStateStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	resource := ctx.NewState()

	// Type assertion to access metadata
	metadataResource, ok := any(resource).(HasMetadata)
	if !ok {
		return fmt.Errorf("resource does not implement HasMetadata interface")
	}

	metadata := metadataResource.GetMetadata()
	if metadata == nil {
		return fmt.Errorf("resource metadata is nil")
	}

	// 1. Clear status field
	// Status is system-managed and should not contain any client-provided data
	statusResource, hasStatus := any(resource).(HasStatus)
	if hasStatus {
		if err := clearStatusField(statusResource); err != nil {
			return fmt.Errorf("failed to clear status field: %w", err)
		}
	}

	// 2. TODO: Clear computed fields (when we have computed fields)

	// 3. Set ID if not already set (idempotent)
	if metadata.Id == "" {
		// Get api_resource_kind from request context (injected by interceptor)
		kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

		// Extract ID prefix from the kind's proto options
		idPrefix, err := apiresource.GetIdPrefix(kind)
		if err != nil {
			return fmt.Errorf("failed to get ID prefix from kind: %w", err)
		}
		metadata.Id = generateID(idPrefix)
	}

	// 4. TODO: Set version (when versioning is implemented)

	// 5. Set audit fields in status
	if hasStatus {
		if err := setAuditFields(statusResource, ctx); err != nil {
			return fmt.Errorf("failed to set audit fields: %w", err)
		}
	}

	return nil
}

// clearStatusField clears the status field to ensure it contains no client-provided data
// If the status field is nil, it will be initialized to an empty status message
func clearStatusField(resource HasStatus) error {
	status := resource.GetStatus()
	if status == nil {
		// Initialize the status field using proto reflection
		resourceMsg := resource.ProtoReflect()
		statusField := resourceMsg.Descriptor().Fields().ByName("status")
		if statusField == nil {
			// Resource doesn't have a status field
			return nil
		}
		
		// Create a new empty status message of the correct type
		statusType := statusField.Message()
		newStatus := dynamicpb.NewMessage(statusType)
		resourceMsg.Set(statusField, protoreflect.ValueOfMessage(newStatus))
		return nil
	}

	// Reset all fields in the status message
	proto.Reset(status)
	return nil
}

// setAuditFields sets the audit information in the status field
//
// For create operations:
// - Both spec_audit and status_audit are set identically
// - created_by and updated_by are the same actor
// - created_at and updated_at are the same timestamp
// - event is set to "created"
//
// This function uses proto reflection to set the audit field generically.
func setAuditFields[T proto.Message](resource HasStatus, ctx *pipeline.RequestContext[T]) error {
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

	// Build audit info for creation
	auditInfo := &commonspb.ApiResourceAuditInfo{
		CreatedBy: actor,
		CreatedAt: now,
		UpdatedBy: actor,
		UpdatedAt: now,
		Event:     "created",
	}

	// Build complete audit with both spec_audit and status_audit
	audit := &commonspb.ApiResourceAudit{
		SpecAudit:   auditInfo,
		StatusAudit: auditInfo,
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

// generateID generates a unique ID for a resource
//
// Format: {prefix}-{unix-nano-timestamp}
// Example: agt-1705678901234567890
func generateID(prefix string) string {
	// Use Unix nanoseconds for uniqueness
	timestamp := time.Now().UnixNano()

	return fmt.Sprintf("%s-%d", prefix, timestamp)
}
