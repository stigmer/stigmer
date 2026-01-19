package steps

import (
	"fmt"
	"strings"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/proto"
)

// ResolveSlugStep generates a URL-friendly slug from the resource name
//
// The slug is generated according to these rules:
//   - Convert to lowercase
//   - Replace spaces with hyphens
//   - Remove special characters (keep only ASCII alphanumeric and hyphens)
//   - Collapse multiple consecutive hyphens into one
//   - Trim leading and trailing hyphens
//   - No length truncation (preserves full slug to avoid collisions)
//
// If the slug is already set, this step is a no-op (idempotent).
//
// Note: Unlike previous versions, this does NOT truncate slugs to avoid
// silent collisions where two different names generate the same slug.
// If slug length is a concern, validation should be added at a higher layer.
//
// Example: "My Cool Agent" -> "my-cool-agent"
type ResolveSlugStep[T proto.Message] struct{}

// NewResolveSlugStep creates a new ResolveSlugStep
func NewResolveSlugStep[T proto.Message]() *ResolveSlugStep[T] {
	return &ResolveSlugStep[T]{}
}

// Name returns the step name
func (s *ResolveSlugStep[T]) Name() string {
	return "ResolveSlug"
}

// Execute generates and sets the slug from the resource name
func (s *ResolveSlugStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
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

	// If slug already set, skip (idempotent)
	if metadata.Slug != "" {
		return nil
	}

	// Generate slug from name
	if metadata.Name == "" {
		return fmt.Errorf("resource name is empty, cannot generate slug")
	}

	slug := generateSlug(metadata.Name)
	metadata.Slug = slug

	return nil
}

// generateSlug converts a name into a URL-friendly slug
//
// This implementation matches the Java version (ApiRequestResourceSlugGenerator.generate)
// by NOT truncating slugs. This prevents silent collisions where two different names
// would generate the same slug after truncation.
func generateSlug(name string) string {
	// 1. Convert to lowercase
	slug := strings.ToLower(name)

	// 2. Replace spaces with hyphens
	slug = strings.ReplaceAll(slug, " ", "-")

	// 3. Remove non-alphanumeric characters except hyphens
	slug = removeNonAlphanumeric(slug)

	// 4. Collapse multiple consecutive hyphens
	slug = collapseHyphens(slug)

	// 5. Trim leading and trailing hyphens
	slug = strings.Trim(slug, "-")

	// Note: No truncation - preserves full slug to avoid collisions
	// If length validation is needed, it should be done at a higher layer
	// with a clear error message rather than silent truncation

	return slug
}

// removeNonAlphanumeric removes all characters except ASCII alphanumeric, hyphens, and spaces
func removeNonAlphanumeric(s string) string {
	var builder strings.Builder
	builder.Grow(len(s))

	for _, r := range s {
		// Keep ASCII letters (a-z, A-Z), digits (0-9), hyphens, and spaces
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == ' ' {
			builder.WriteRune(r)
		}
	}

	return builder.String()
}

// collapseHyphens replaces multiple consecutive hyphens with a single hyphen
func collapseHyphens(s string) string {
	var builder strings.Builder
	builder.Grow(len(s))

	lastWasHyphen := false
	for _, r := range s {
		if r == '-' {
			if !lastWasHyphen {
				builder.WriteRune(r)
				lastWasHyphen = true
			}
		} else {
			builder.WriteRune(r)
			lastWasHyphen = false
		}
	}

	return builder.String()
}
