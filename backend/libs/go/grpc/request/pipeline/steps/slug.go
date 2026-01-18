package steps

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"google.golang.org/protobuf/proto"
)

// HasMetadata is an interface for resources that have ApiResourceMetadata
type HasMetadata interface {
	GetMetadata() *apiresource.ApiResourceMetadata
}

// ResolveSlugStep generates a URL-friendly slug from the resource name
//
// The slug is generated according to these rules:
//   - Convert to lowercase
//   - Replace spaces with hyphens
//   - Remove special characters (keep only alphanumeric and hyphens)
//   - Collapse multiple consecutive hyphens into one
//   - Trim leading and trailing hyphens
//   - Limit to 63 characters (Kubernetes DNS label limit)
//
// If the slug is already set, this step is a no-op (idempotent).
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

	// 6. Limit to 63 characters (Kubernetes DNS label limit)
	if len(slug) > 63 {
		slug = slug[:63]
		// Ensure we don't end with a hyphen after truncation
		slug = strings.TrimRight(slug, "-")
	}

	return slug
}

// removeNonAlphanumeric removes all characters except alphanumeric and hyphens
func removeNonAlphanumeric(s string) string {
	var builder strings.Builder
	builder.Grow(len(s))

	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' {
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
