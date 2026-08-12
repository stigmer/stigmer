package steps

import (
	"crypto/rand"
	"fmt"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	commonspb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// BuildNewStateStep builds the new state for a resource during creation
//
// This step performs the following operations (aligned with Java's CreateOperationBuildNewStateStepV2):
//  1. Clear status field (status is system-managed, not client-modifiable)
//  2. Clear computed fields (TODO: when needed)
//  3. Set metadata.id: Generated from kind prefix + ULID (if not set)
//  4. Set version (TODO: when versioning is implemented)
//  5. Set audit fields in status.audit:
//     - created_by (actor)
//     - created_at (timestamp)
//     - updated_by (actor)
//     - updated_at (timestamp)
//     - event (ApiResourceEventType.created)
//     - Both spec_audit and status_audit are set identically for create operations
//  6. Set metadata.visibility to the kind's default when the client left it
//     unspecified, so consumers never have to treat UNSPECIFIED as an implicit
//     level. The default is config-driven via the kind's proto VisibilityConfig
//     (apiresource.DefaultVisibilityFor): blueprint kinds flagged
//     defaults_to_org_visibility (agent, skill, workflow, mcp_server) get
//     visibility_org — blueprints are shared org assets, and a private default
//     would silently hide every new blueprint from the author's teammates once
//     visibility enforcement is real; private is an explicit opt-in. Every
//     other kind gets visibility_private. This mirrors the cloud edition,
//     where CreateOperationBuildNewStateStepV2 composes
//     CreateOperationSetDefaultVisibilityStepV2 for every kind's create; the
//     cross-edition contract is pinned by TestVisibilityCreateDefaults
//     (test/integration, exercises the Java service) and the per-kind create
//     pins in test/conformance (exercise both editions).
//
// The step is idempotent - if ID is already set, it will not override it;
// an explicitly provided visibility is never overwritten.
//
// The api_resource_kind is extracted from request context (injected by interceptor).
//
// Example:
//
//	For kind=ApiResourceKind_agent
//	Generated ID: "agt_01arz3ndektsv4rrffq69g5fav"
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

	// 6. Default metadata.visibility from the kind's proto config when the
	// client left it unspecified (blueprints -> visibility_org, everything
	// else -> visibility_private; see the step doc for the full contract).
	if metadata.Visibility == commonspb.ApiResourceVisibility_api_resource_visibility_unspecified {
		kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
		visibility, err := apiresource.DefaultVisibilityFor(kind)
		if err != nil {
			return fmt.Errorf("failed to resolve default visibility from kind: %w", err)
		}
		metadata.Visibility = visibility
	}

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

// SetAuditFieldsForCreate sets audit fields for a newly created resource
//
// This sets:
// - created_by and updated_by to the same actor
// - created_at and updated_at to the same timestamp
// - event to "created"
//
// Both spec_audit and status_audit are set identically for new resources.
// This function is exported so custom steps can use it for audit field management.
func SetAuditFieldsForCreate(resource proto.Message) error {
	return setAuditFieldsReflect(resource, "created")
}

// SetAuditFieldsForUpdate sets audit fields for an updated resource
//
// This preserves created_by and created_at from the existing resource (must be set prior),
// and updates updated_by and updated_at to current values.
//
// This function is exported so custom steps can use it for audit field management.
func SetAuditFieldsForUpdate(resource proto.Message) error {
	return setAuditFieldsReflect(resource, "updated")
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

// GenerateID generates a unique ID for a resource using ULID
//
// Format: {prefix}_{lowercase-ulid}
// Example: agt_01arz3ndektsv4rrffq69g5fav
//
// ULID (Universally Unique Lexicographically Sortable Identifier) provides:
// - Lexicographic sorting (time-ordered)
// - 128-bit compatibility with UUID
// - Monotonicity within the same millisecond
// - URL-safe encoding (lowercase for consistency)
//
// This function is exported so custom steps can use it for ID generation.
func GenerateID(prefix string) string {
	id := ulid.MustNew(ulid.Timestamp(time.Now()), rand.Reader)

	return fmt.Sprintf("%s_%s", prefix, strings.ToLower(id.String()))
}

// generateID is kept for backward compatibility within this package
func generateID(prefix string) string {
	return GenerateID(prefix)
}
