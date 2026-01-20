package steps

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
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
// The slug fallback enables Apply operations where users provide name/slug
// instead of ID. Direct update calls with ID continue to work efficiently.
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
		// Fallback to slug-based lookup (for apply operations)
		found, err := s.findBySlug(ctx.Context(), metadata.Slug, kind)
		if err != nil {
			return fmt.Errorf("failed to load resource by slug: %w", err)
		}
		if found == nil {
			kindName, _ := apiresource.GetKindName(kind)
			return grpclib.NotFoundError(kindName, metadata.Slug)
		}
		existing = found.(T)

		// Populate ID from existing resource into input metadata
		// This ensures subsequent steps (merge, persist) have the ID
		existingMetadata := existing.(HasMetadata).GetMetadata()
		metadata.Id = existingMetadata.Id
	} else {
		return grpclib.InvalidArgumentError("resource id or slug is required for update")
	}

	// Store existing resource in context metadata for merge step
	ctx.Set(ExistingResourceKey, existing)

	return nil
}

// findBySlug searches for a resource by slug
// Returns the resource if found, nil if not found, error if database operation fails
func (s *LoadExistingStep[T]) findBySlug(ctx context.Context, slug string, kind apiresourcekind.ApiResourceKind) (proto.Message, error) {
	resources, err := s.store.ListResources(ctx, kind)
	if err != nil {
		return nil, fmt.Errorf("failed to list resources: %w", err)
	}

	// Scan through resources to find matching slug
	for _, data := range resources {
		// Create a new instance of T to unmarshal into
		var resource T
		resource = resource.ProtoReflect().New().Interface().(T)

		// Use proto.Unmarshal since stores return proto bytes (not JSON)
		if err := proto.Unmarshal(data, resource); err != nil {
			// Skip resources that can't be unmarshaled
			continue
		}

		// Check if this resource has the matching slug
		if metadataResource, ok := any(resource).(HasMetadata); ok {
			metadata := metadataResource.GetMetadata()
			if metadata != nil && metadata.Slug == slug {
				return resource, nil
			}
		}
	}

	return nil, nil
}
