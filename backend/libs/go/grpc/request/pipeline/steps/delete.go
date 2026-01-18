package steps

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/proto"
)

// Context keys for delete operations
const (
	DeletedResourceKey = "deletedResource" // Stores the deleted resource for return
	ResourceIdKey      = "resourceId"      // Stores the extracted resource ID
)

// HasValue is an interface for ID wrapper types (e.g., AgentId, WorkflowId)
// These are proto messages that wrap a string ID value.
type HasValue interface {
	GetValue() string
}

// ExtractResourceIdStep extracts the resource ID from ID wrapper types
//
// This step:
//  1. Extracts the ID value from the wrapper (e.g., AgentId.Value)
//  2. Stores the ID in context for use by subsequent steps
//  3. Validates that the ID is not empty
//
// Used in Delete and Get operations where input is an ID wrapper, not the full resource.
type ExtractResourceIdStep[T proto.Message] struct{}

// NewExtractResourceIdStep creates a new ExtractResourceIdStep
func NewExtractResourceIdStep[T proto.Message]() *ExtractResourceIdStep[T] {
	return &ExtractResourceIdStep[T]{}
}

// Name returns the step name
func (s *ExtractResourceIdStep[T]) Name() string {
	return "ExtractResourceId"
}

// Execute extracts the resource ID from the input
func (s *ExtractResourceIdStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	input := ctx.Input()

	// Type assertion to get the ID value
	idWrapper, ok := any(input).(HasValue)
	if !ok {
		return fmt.Errorf("input does not implement HasValue interface")
	}

	id := idWrapper.GetValue()
	if id == "" {
		return grpclib.InvalidArgumentError("resource id is required")
	}

	// Store ID in context for subsequent steps
	ctx.Set(ResourceIdKey, id)

	return nil
}

// LoadExistingForDeleteStep loads the existing resource before deletion
//
// This step:
//  1. Retrieves resource ID from context (set by ExtractResourceIdStep)
//  2. Loads the resource from the database
//  3. Stores the loaded resource in context (for return value and audit trail)
//  4. Returns NotFound error if resource doesn't exist
//
// Unlike LoadExistingStep (used in Update), this step works with ID input types.
type LoadExistingForDeleteStep[T proto.Message, R proto.Message] struct {
	store interface {
		GetResource(ctx context.Context, kind string, id string, resource interface{}) error
	}
}

// NewLoadExistingForDeleteStep creates a new LoadExistingForDeleteStep
//
// Type parameters:
//   - T: The input type (ID wrapper, e.g., *AgentId)
//   - R: The resource type (e.g., *Agent)
func NewLoadExistingForDeleteStep[T proto.Message, R proto.Message](
	store interface {
		GetResource(ctx context.Context, kind string, id string, resource interface{}) error
	},
) *LoadExistingForDeleteStep[T, R] {
	return &LoadExistingForDeleteStep[T, R]{store: store}
}

// Name returns the step name
func (s *LoadExistingForDeleteStep[T, R]) Name() string {
	return "LoadExistingForDelete"
}

// Execute loads the existing resource from the database
func (s *LoadExistingForDeleteStep[T, R]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Get resource ID from context (set by ExtractResourceIdStep)
	idVal := ctx.Get(ResourceIdKey)
	if idVal == nil {
		return fmt.Errorf("resource id not found in context (ExtractResourceIdStep must run first)")
	}
	id := idVal.(string)

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// Extract kind name from the enum's proto options
	kindName, err := apiresource.GetKindName(kind)
	if err != nil {
		return fmt.Errorf("failed to get kind name: %w", err)
	}

	// Create a new instance of the resource type for loading
	var resource R
	resource = resource.ProtoReflect().New().Interface().(R)

	// Load from database
	err = s.store.GetResource(ctx.Context(), kindName, id, resource)
	if err != nil {
		return grpclib.NotFoundError(kindName, id)
	}

	// Store loaded resource in context for return value
	ctx.Set(ExistingResourceKey, resource)

	return nil
}

// DeleteResourceStep deletes the resource from the database
//
// This step:
//  1. Retrieves resource ID from context (set by ExtractResourceIdStep)
//  2. Deletes the resource from the database
//  3. Returns InternalError if deletion fails
//
// The resource must be loaded first (by LoadExistingForDeleteStep) to ensure it exists
// and to have it available for the return value.
type DeleteResourceStep[T proto.Message] struct {
	store interface {
		DeleteResource(ctx context.Context, kind string, id string) error
	}
}

// NewDeleteResourceStep creates a new DeleteResourceStep
func NewDeleteResourceStep[T proto.Message](
	store interface {
		DeleteResource(ctx context.Context, kind string, id string) error
	},
) *DeleteResourceStep[T] {
	return &DeleteResourceStep[T]{store: store}
}

// Name returns the step name
func (s *DeleteResourceStep[T]) Name() string {
	return "DeleteResource"
}

// Execute deletes the resource from the database
func (s *DeleteResourceStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	// Get resource ID from context (set by ExtractResourceIdStep)
	idVal := ctx.Get(ResourceIdKey)
	if idVal == nil {
		return fmt.Errorf("resource id not found in context (ExtractResourceIdStep must run first)")
	}
	id := idVal.(string)

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// Extract kind name from the enum's proto options
	kindName, err := apiresource.GetKindName(kind)
	if err != nil {
		return fmt.Errorf("failed to get kind name: %w", err)
	}

	// Delete from database
	if err := s.store.DeleteResource(ctx.Context(), kindName, id); err != nil {
		return grpclib.InternalError(err, fmt.Sprintf("failed to delete %s", kindName))
	}

	return nil
}
