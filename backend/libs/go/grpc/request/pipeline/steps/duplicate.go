package steps

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/sqlite"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// CheckDuplicateStep verifies that no resource with the same slug exists
//
// This step searches for existing resources by slug globally.
// If a duplicate is found, returns ALREADY_EXISTS error.
//
// The step requires:
//   - metadata.slug must be set (typically by ResolveSlugStep)
type CheckDuplicateStep[T proto.Message] struct {
	store *sqlite.Store
	kind  string
}

// NewCheckDuplicateStep creates a new CheckDuplicateStep
//
// Parameters:
//   - store: The SQLite store instance
//   - kind: The resource kind (e.g., "Agent", "Workflow")
func NewCheckDuplicateStep[T proto.Message](store *sqlite.Store, kind string) *CheckDuplicateStep[T] {
	return &CheckDuplicateStep[T]{
		store: store,
		kind:  kind,
	}
}

// Name returns the step name
func (s *CheckDuplicateStep[T]) Name() string {
	return "CheckDuplicate"
}

// Execute checks for duplicate resources by slug
func (s *CheckDuplicateStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
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

	// Verify slug is set
	if metadata.Slug == "" {
		return fmt.Errorf("resource slug is empty, cannot check for duplicates")
	}

	// Check for duplicate by slug
	existing, err := s.findBySlug(ctx.Context(), metadata.Slug)
	if err != nil {
		return fmt.Errorf("failed to check for duplicates: %w", err)
	}

	// If duplicate found, return error
	if existing != nil {
		existingMetadata := existing.(HasMetadata).GetMetadata()
		return fmt.Errorf("%s with slug '%s' already exists (id: %s)", s.kind, metadata.Slug, existingMetadata.Id)
	}

	return nil
}

// findBySlug searches for a resource by slug globally
func (s *CheckDuplicateStep[T]) findBySlug(ctx context.Context, slug string) (proto.Message, error) {
	resources, err := s.store.ListResources(ctx, s.kind)
	if err != nil {
		return nil, fmt.Errorf("failed to list resources: %w", err)
	}

	// Scan through resources to find matching slug
	for _, data := range resources {
		// Create a new instance of T to unmarshal into
		var resource T
		resource = resource.ProtoReflect().New().Interface().(T)

		if err := protojson.Unmarshal(data, resource); err != nil {
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
