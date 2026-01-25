package steps

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// FindResourceBySlug searches for a resource by slug
//
// This is a generic helper to avoid duplicating findBySlug logic across multiple steps.
// It searches through all resources of the given kind and returns the first match.
//
// Returns:
//   - resource: The found resource (nil if not found)
//   - error: Database error (does NOT return error if resource not found)
//
// Usage:
//
//	skill, err := steps.FindResourceBySlug[*skillv1.Skill](ctx, store, kind, "my-skill")
//	if err != nil {
//	    return err // database error
//	}
//	if skill != nil {
//	    // found existing skill
//	}
func FindResourceBySlug[T proto.Message](ctx context.Context, s store.Store, kind apiresourcekind.ApiResourceKind, slug string) (T, error) {
	var zero T

	resources, err := s.ListResources(ctx, kind)
	if err != nil {
		return zero, fmt.Errorf("failed to list resources: %w", err)
	}

	// Scan through resources to find matching slug
	for _, data := range resources {
		// Create a new instance of T to unmarshal into
		var resource T
		resource = resource.ProtoReflect().New().Interface().(T)

		// Use proto.Unmarshal since stores return proto bytes
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

	// Not found - return nil (not an error)
	return zero, nil
}
