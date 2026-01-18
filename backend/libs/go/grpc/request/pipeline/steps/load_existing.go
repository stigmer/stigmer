package steps

import (
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// Context key for storing existing resource
const ExistingResourceKey = "existingResource"

// LoadExistingStep loads the existing resource from the database
//
// This step:
//  1. Extracts resource ID from input metadata.id
//  2. Loads existing resource from database
//  3. Stores existing resource in context for merge step
//  4. Returns NotFound error if resource doesn't exist
//
// The step is typically used in Update and Delete operations.
type LoadExistingStep[T proto.Message] struct {
	store store.Store
}

// NewLoadExistingStep creates a new LoadExistingStep
//
// Parameters:
//   - store: The store instance (implements store.Store interface)
//
// The api_resource_kind is automatically extracted from the request context
// by the apiresource interceptor during request handling.
func NewLoadExistingStep[T proto.Message](s store.Store) *LoadExistingStep[T] {
	return &LoadExistingStep[T]{
		store: s,
	}
}

// Name returns the step name
func (s *LoadExistingStep[T]) Name() string {
	return "LoadExisting"
}

// Execute loads the existing resource from the database
func (s *LoadExistingStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	input := ctx.Input()

	// Type assertion to access metadata
	metadataResource, ok := any(input).(HasMetadata)
	if !ok {
		return fmt.Errorf("resource does not implement HasMetadata interface")
	}

	metadata := metadataResource.GetMetadata()
	if metadata == nil {
		return fmt.Errorf("resource metadata is nil")
	}

	// Verify ID is provided
	if metadata.Id == "" {
		return grpclib.InvalidArgumentError("resource id is required for update")
	}

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// Extract kind name from the enum's proto options
	kindName, err := apiresource.GetKindName(kind)
	if err != nil {
		return fmt.Errorf("failed to get kind name: %w", err)
	}

	// Create a new instance of the same type for loading
	var existing T
	existing = proto.Clone(input).(T)

	// Load from database
	err = s.store.GetResource(ctx.Context(), kindName, metadata.Id, existing)
	if err != nil {
		// Convert store error to NotFound gRPC error
		return grpclib.NotFoundError(kindName, metadata.Id)
	}

	// Store existing resource in context metadata for merge step
	ctx.Set(ExistingResourceKey, existing)

	return nil
}
