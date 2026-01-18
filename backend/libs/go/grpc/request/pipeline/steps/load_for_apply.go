package steps

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// Context keys for apply operation
const (
	// ExistsInDatabaseKey stores whether the resource already exists (bool)
	ExistsInDatabaseKey = "existsInDatabase"
	// ShouldCreateKey stores whether to create (true) or update (false) (bool)
	ShouldCreateKey = "shouldCreate"
)

// LoadForApplyStep optionally loads an existing resource for apply operations
//
// This step:
//  1. Attempts to load existing resource by slug (from metadata.slug set by ResolveSlugStep)
//  2. If found:
//     - Stores existing resource in context (ExistingResourceKey)
//     - Sets existsInDatabase = true
//     - Sets shouldCreate = false
//     - Populates input metadata.id with existing ID
//  3. If not found:
//     - Sets existsInDatabase = false
//     - Sets shouldCreate = true
//  4. NEVER fails - NotFound is a valid outcome for apply
//
// The step is used in Apply operations to determine whether to create or update.
// It differs from LoadExistingStep which FAILS on NotFound (for Update/Delete).
//
// Usage in controller:
//
//	func (c *Controller) Apply(ctx context.Context, resource *Resource) (*Resource, error) {
//	    reqCtx := pipeline.NewRequestContext(ctx, resource)
//	    p := c.buildApplyPipeline()
//	    if err := p.Execute(reqCtx); err != nil {
//	        return nil, err
//	    }
//	    // Check context to determine next step
//	    shouldCreate := reqCtx.Get(steps.ShouldCreateKey).(bool)
//	    if shouldCreate {
//	        return c.Create(ctx, resource)
//	    }
//	    return c.Update(ctx, resource)
//	}
type LoadForApplyStep[T proto.Message] struct {
	store store.Store
}

// NewLoadForApplyStep creates a new LoadForApplyStep
//
// Parameters:
//   - store: The store instance (implements store.Store interface)
//
// The api_resource_kind is automatically extracted from the request context
// by the apiresource interceptor during request handling.
func NewLoadForApplyStep[T proto.Message](s store.Store) *LoadForApplyStep[T] {
	return &LoadForApplyStep[T]{
		store: s,
	}
}

// Name returns the step name
func (s *LoadForApplyStep[T]) Name() string {
	return "LoadForApply"
}

// Execute attempts to load the existing resource (doesn't fail if not found)
func (s *LoadForApplyStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	resource := ctx.NewState()

	// Type assertion to access metadata
	metadataResource, ok := any(resource).(HasMetadata)
	if !ok {
		// For apply, if resource doesn't have metadata, we'll create it
		ctx.Set(ExistsInDatabaseKey, false)
		ctx.Set(ShouldCreateKey, true)
		return nil
	}

	metadata := metadataResource.GetMetadata()
	if metadata == nil {
		// No metadata - create new
		ctx.Set(ExistsInDatabaseKey, false)
		ctx.Set(ShouldCreateKey, true)
		return nil
	}

	// Check if slug is set (should be set by ResolveSlugStep)
	if metadata.Slug == "" {
		// No slug - create new
		ctx.Set(ExistsInDatabaseKey, false)
		ctx.Set(ShouldCreateKey, true)
		return nil
	}

	slug := metadata.Slug

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// Extract kind name from the enum's proto options
	kindName, err := apiresource.GetKindName(kind)
	if err != nil {
		// Can't determine kind - create new
		ctx.Set(ExistsInDatabaseKey, false)
		ctx.Set(ShouldCreateKey, true)
		return nil
	}

	// Attempt to find existing resource by slug
	existing, err := s.findBySlug(ctx.Context(), slug, kindName)
	if err != nil {
		// Database error - fail the operation
		return fmt.Errorf("failed to check for existing resource: %w", err)
	}

	if existing == nil {
		// Resource doesn't exist - CREATE
		ctx.Set(ExistsInDatabaseKey, false)
		ctx.Set(ShouldCreateKey, true)
		return nil
	}

	// Resource exists - UPDATE
	// Store existing resource in context for potential use
	ctx.Set(ExistingResourceKey, existing)
	ctx.Set(ExistsInDatabaseKey, true)
	ctx.Set(ShouldCreateKey, false)

	// Set the existing resource's ID into the input metadata
	// This ensures Update operations have the correct ID
	existingMetadata := existing.(HasMetadata).GetMetadata()
	if metadata.Id == "" {
		metadata.Id = existingMetadata.Id
	}

	return nil
}

// findBySlug searches for a resource by slug globally
// Returns the resource if found, nil if not found, error if database operation fails
func (s *LoadForApplyStep[T]) findBySlug(ctx context.Context, slug string, kindName string) (proto.Message, error) {
	resources, err := s.store.ListResources(ctx, kindName)
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
