package steps

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// FindResourceBySlug searches for a resource by slug within an organization.
//
// This is a generic helper to avoid duplicating findBySlug logic across multiple steps.
// It searches through all resources of the given kind and returns the first match
// scoped to the specified org.
//
// Slugs are org-scoped identifiers: the same slug can exist in different orgs.
// When org is non-empty, only resources belonging to that org are considered.
// When org is empty, no org filtering is applied (matches any org).
//
// Returns:
//   - resource: The found resource (zero value if not found)
//   - found: true if a matching resource was found
//   - error: Database error (does NOT return error if resource not found)
//
// Usage:
//
//	skill, found, err := steps.FindResourceBySlug[*skillv1.Skill](ctx, store, kind, "my-skill", "default")
//	if err != nil {
//	    return err // database error
//	}
//	if found {
//	    // found existing skill in org "default"
//	}
func FindResourceBySlug[T proto.Message](ctx context.Context, s store.Store, kind apiresourcekind.ApiResourceKind, slug string, org string) (T, bool, error) {
	var zero T

	resources, err := s.ListResources(ctx, kind)
	if err != nil {
		return zero, false, fmt.Errorf("failed to list resources: %w", err)
	}

	for _, data := range resources {
		var resource T
		resource = resource.ProtoReflect().New().Interface().(T)

		if err := proto.Unmarshal(data, resource); err != nil {
			continue
		}

		if metadataResource, ok := any(resource).(HasMetadata); ok {
			metadata := metadataResource.GetMetadata()
			if metadata != nil && metadata.Slug == slug {
				if org != "" && metadata.Org != org {
					continue
				}
				return resource, true, nil
			}
		}
	}

	return zero, false, nil
}
