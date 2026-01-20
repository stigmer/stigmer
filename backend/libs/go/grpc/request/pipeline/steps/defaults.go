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

	fmt.Printf("[DEBUG BuildNewStateStep] BEFORE processing: metadata.Name=%s, metadata.Slug=%s\n", metadata.Name, metadata.Slug)

	// 1. Clear status field using proto reflection
	// Status is system-managed and should not contain any client-provided data
	if hasStatusField(resource) {
		if err := clearStatusFieldReflect(resource); err != nil {
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

	// 5. Set audit fields in status using proto reflection
	if hasStatusField(resource) {
		if err := setAuditFieldsReflect(resource, "created"); err != nil {
			return fmt.Errorf("failed to set audit fields: %w", err)
		}
	}

	fmt.Printf("[DEBUG BuildNewStateStep] AFTER processing: metadata.Name=%s, metadata.Slug=%s, metadata.Id=%s\n", 
		metadata.Name, metadata.Slug, metadata.Id)

	return nil
}

// clearStatusFieldReflect clears the status field to ensure it contains no client-provided data
// Uses proto reflection to access the status field generically.
// If the status field is nil or already empty, nothing needs to be done.
func clearStatusFieldReflect(resource proto.Message) error {
	statusMsg := getStatusField(resource)
	if statusMsg == nil {
		// Status is nil or doesn't exist - nothing to clear
		return nil
	}

	// Check if status is already empty (no fields set)
	fields := statusMsg.Descriptor().Fields()
	hasData := false
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		if statusMsg.Has(field) {
			hasData = true
			break
		}
	}

	// If status is already empty, don't clear it
	if !hasData {
		return nil
	}

	// Clear all fields in the status message
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		statusMsg.Clear(field)
	}
	return nil
}

// setAuditFieldsReflect sets the audit information in the status field using proto reflection
//
// For create operations (event="created"):
// - Both spec_audit and status_audit are set identically
// - created_by and updated_by are the same actor
// - created_at and updated_at are the same timestamp
//
// For update operations (event="updated"):
// - spec_audit and status_audit are set with current actor/timestamp
//
// This function uses proto reflection to set the audit field generically.
// The status field is created if it doesn't exist.
func setAuditFieldsReflect(resource proto.Message, event string) error {
	// Get or create status field using proto reflection
	statusMsg := getOrCreateStatusField(resource)
	if statusMsg == nil {
		// Resource doesn't have a status field - this is OK for some resource types
		return nil
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

	// Build audit info
	auditInfo := &commonspb.ApiResourceAuditInfo{
		CreatedBy: actor,
		CreatedAt: now,
		UpdatedBy: actor,
		UpdatedAt: now,
		Event:     event,
	}

	// Build complete audit with both spec_audit and status_audit
	audit := &commonspb.ApiResourceAudit{
		SpecAudit:   auditInfo,
		StatusAudit: auditInfo,
	}

	// Use proto reflection to set audit field
	auditField := statusMsg.Descriptor().Fields().ByName("audit")
	if auditField == nil {
		// Status doesn't have an audit field - this is ok for some resource types
		return nil
	}

	// Set the audit field
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
