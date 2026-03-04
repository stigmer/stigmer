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
//  1. Attempts to load by ID (from metadata.id) if provided
//  2. Falls back to loading by slug (from metadata.slug) if ID is empty
//  3. Stores existing resource in context for merge step
//  4. Populates ID into metadata if loaded by slug
//  5. Returns NotFound error if resource doesn't exist
//
// The slug fallback is org-scoped: when metadata.org is set, only resources
// belonging to that org are considered. This prevents cross-org slug collisions
// in Update and Delete operations. Direct update calls with ID continue to
// work efficiently.
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
	input := ctx.NewState()

	// Type assertion to access metadata
	metadataResource, ok := any(input).(HasMetadata)
	if !ok {
		return fmt.Errorf("resource does not implement HasMetadata interface")
	}

	metadata := metadataResource.GetMetadata()
	if metadata == nil {
		return fmt.Errorf("resource metadata is nil")
	}

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	var existing T

	// Try loading by ID first (faster, direct lookup)
	if metadata.Id != "" {
		existing = proto.Clone(input).(T)
		err := s.store.GetResource(ctx.Context(), kind, metadata.Id, existing)
		if err != nil {
			kindName, _ := apiresource.GetKindName(kind)
			return grpclib.NotFoundError(kindName, metadata.Id)
		}
	} else if metadata.Slug != "" {
		org := metadata.Org
		result, found, err := FindResourceBySlug[T](ctx.Context(), s.store, kind, metadata.Slug, org)
		if err != nil {
			return fmt.Errorf("failed to load resource by slug: %w", err)
		}
		if !found {
			kindName, _ := apiresource.GetKindName(kind)
			return grpclib.NotFoundError(kindName, metadata.Slug)
		}
		existing = result

		// Populate ID from existing resource into input metadata
		// This ensures subsequent steps (merge, persist) have the ID
		existingMetadata := any(existing).(HasMetadata).GetMetadata()
		metadata.Id = existingMetadata.Id
	} else {
		return grpclib.InvalidArgumentError("resource id or slug is required for update")
	}

	// Store existing resource in context metadata for merge step
	ctx.Set(ExistingResourceKey, existing)

	return nil
}
