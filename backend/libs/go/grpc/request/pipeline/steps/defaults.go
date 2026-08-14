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
		if err := SetAuditFieldsForCreate(resource); err != nil {
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
// The status field is created if it doesn't exist; resources without a
// status field (or without an audit field within it) are a no-op.
//
// This function is exported so custom steps can use it for audit field management.
func SetAuditFieldsForCreate(resource proto.Message) error {
	now := timestamppb.Now()
	actor := currentAuditActor()

	auditInfo := &commonspb.ApiResourceAuditInfo{
		CreatedBy: actor,
		CreatedAt: now,
		UpdatedBy: actor,
		UpdatedAt: now,
		Event:     "created",
	}

	return setAuditReflect(resource, &commonspb.ApiResourceAudit{
		SpecAudit:   auditInfo,
		StatusAudit: auditInfo,
	})
}

// AuditSlot names which half of status.audit a targeted mutation writes.
// Zero is invalid — callers must pick SpecAudit or StatusAudit. The
// required argument is the census: every SetAuditFieldsForUpdate call
// site fails to compile until it declares which slot it owns
// (stigmer/stigmer#540).
type AuditSlot int

const (
	// SpecAudit is the definition-changed slot (search recency, version
	// "pushed at", created_at-sorted library lists). Stamp it when spec
	// or other definition fields changed.
	SpecAudit AuditSlot = iota + 1
	// StatusAudit is the operational-changed slot (Recents, lifecycle
	// metadata). Stamp it when only status or metadata such as
	// visibility changed.
	StatusAudit
)

func (s AuditSlot) fieldName() (protoreflect.Name, error) {
	switch s {
	case SpecAudit:
		return "spec_audit", nil
	case StatusAudit:
		return "status_audit", nil
	default:
		return "", fmt.Errorf("invalid audit slot %d: must be SpecAudit or StatusAudit", int(s))
	}
}

// SetAuditFieldsForUpdate stamps one audit slot on a targeted mutation.
//
// The named slot keeps its created_by/created_at (falling back to the
// current actor/time when that slot had no prior audit) and gets a fresh
// updated_by/updated_at with event "updated". The other slot is not
// rewritten — it stays proto-equal to before, including when it is
// absent. A first write therefore creates only the stamped slot; it does
// not invent the other.
//
// The write Sets a newly allocated slot message onto the existing audit
// wrapper. It must not mutate the existing slot in place: skill push
// copies SpecAudit/StatusAudit pointers from the loaded skill onto a new
// wrapper, and in-place field assignment would corrupt that in-memory
// original (stigmer/stigmer#540).
//
// Callers hand this the loaded resource they mutated in place (or one
// that carries the existing audit copied onto it, as skill push does),
// so the resource itself is the source of creation truth.
//
// Unlike BuildUpdateStateStep's updateAuditFieldsReflect — which
// wholesale-replaces both slots because the full Update pipeline rebuilds
// status from the request — this helper is for targeted mutations
// (visibility flips, skill push, schedule stamps, soft deletes) that
// change one class of field.
//
// This function is exported so custom steps can use it for audit field management.
func SetAuditFieldsForUpdate(resource proto.Message, slot AuditSlot) error {
	fieldName, err := slot.fieldName()
	if err != nil {
		return err
	}

	now := timestamppb.Now()
	actor := currentAuditActor()
	createdBy, createdAt := creationAuditOf(resource, fieldName)
	return setAuditSlotReflect(resource, fieldName, updatedAuditInfo(createdBy, createdAt, actor, now))
}

// setAuditSlotReflect writes one audit-info message onto the named slot
// of status.audit, creating status/audit if needed. The other slot is
// left untouched. Resources without a status field, or whose status has
// no audit field, are a no-op.
func setAuditSlotReflect(
	resource proto.Message,
	slot protoreflect.Name,
	info *commonspb.ApiResourceAuditInfo,
) error {
	statusMsg := getOrCreateStatusField(resource)
	if statusMsg == nil {
		return nil
	}

	auditField := statusMsg.Descriptor().Fields().ByName("audit")
	if auditField == nil {
		return nil
	}

	// Mutable creates an empty audit wrapper when none exists, without
	// replacing a wrapper that already holds the other slot.
	auditMsg := statusMsg.Mutable(auditField).Message()
	slotField := auditMsg.Descriptor().Fields().ByName(slot)
	if slotField == nil {
		return nil
	}

	auditMsg.Set(slotField, protoreflect.ValueOfMessage(info.ProtoReflect()))
	return nil
}

// currentAuditActor returns the actor to stamp on audit fields.
//
// TODO: Get actual caller information from auth context when auth is implemented
// For now, use system/local placeholder
func currentAuditActor() *commonspb.ApiResourceAuditActor {
	return &commonspb.ApiResourceAuditActor{
		Id:     "system",
		Avatar: "",
	}
}

// updatedAuditInfo builds the post-update audit info: preserved creation
// identity (falling back to the updating actor/time when the resource had
// none) and a fresh update stamp.
func updatedAuditInfo(
	createdBy *commonspb.ApiResourceAuditActor,
	createdAt *timestamppb.Timestamp,
	actor *commonspb.ApiResourceAuditActor,
	now *timestamppb.Timestamp,
) *commonspb.ApiResourceAuditInfo {
	if createdBy == nil {
		createdBy = actor
	}
	if createdAt == nil {
		createdAt = now
	}
	return &commonspb.ApiResourceAuditInfo{
		CreatedBy: createdBy,
		CreatedAt: createdAt,
		UpdatedBy: actor,
		UpdatedAt: now,
		Event:     "updated",
	}
}

// creationAuditOf extracts created_by and created_at from the named audit
// slot ("spec_audit" or "status_audit") of a resource's status.audit,
// using proto reflection. Returns deep copies so the values survive the
// audit field being overwritten. Either return may be nil when the
// resource, its status, the audit, the slot, or the individual field is
// absent — callers decide the fallback.
func creationAuditOf(
	resource proto.Message,
	auditSlot protoreflect.Name,
) (*commonspb.ApiResourceAuditActor, *timestamppb.Timestamp) {
	statusMsg := getStatusField(resource)
	if statusMsg == nil {
		return nil, nil
	}

	auditField := statusMsg.Descriptor().Fields().ByName("audit")
	if auditField == nil || !statusMsg.Has(auditField) {
		return nil, nil
	}
	auditMsg := statusMsg.Get(auditField).Message()

	slotField := auditMsg.Descriptor().Fields().ByName(auditSlot)
	if slotField == nil || !auditMsg.Has(slotField) {
		return nil, nil
	}
	slotMsg := auditMsg.Get(slotField).Message()

	var createdBy *commonspb.ApiResourceAuditActor
	var createdAt *timestamppb.Timestamp

	if f := slotMsg.Descriptor().Fields().ByName("created_by"); f != nil && slotMsg.Has(f) {
		createdBy = &commonspb.ApiResourceAuditActor{}
		proto.Merge(createdBy, slotMsg.Get(f).Message().Interface())
	}
	if f := slotMsg.Descriptor().Fields().ByName("created_at"); f != nil && slotMsg.Has(f) {
		createdAt = &timestamppb.Timestamp{}
		proto.Merge(createdAt, slotMsg.Get(f).Message().Interface())
	}

	return createdBy, createdAt
}

// setAuditReflect writes the audit block onto the resource's status via
// proto reflection, creating the status field if needed. Resources
// without a status field, or whose status has no audit field, are a
// no-op — that is OK for some resource types.
func setAuditReflect(resource proto.Message, audit *commonspb.ApiResourceAudit) error {
	statusMsg := getOrCreateStatusField(resource)
	if statusMsg == nil {
		return nil
	}

	auditField := statusMsg.Descriptor().Fields().ByName("audit")
	if auditField == nil {
		return nil
	}

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
