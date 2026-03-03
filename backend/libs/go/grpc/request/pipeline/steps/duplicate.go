package steps

import (
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// CheckDuplicateStep verifies that no resource with the same slug exists within the same org
//
// This step searches for existing resources by slug+org using the shared
// FindResourceBySlug helper. Slugs are org-scoped: the same slug can exist
// in different orgs. If a duplicate is found within the same org, returns an error.
//
// The step requires:
//   - metadata.slug must be set (typically by ResolveSlugStep)
//   - metadata.org is used for org-scoped lookup (empty org falls back to global check)
//   - api_resource_kind is extracted from request context (injected by interceptor)
type CheckDuplicateStep[T proto.Message] struct {
	store store.Store
}

// NewCheckDuplicateStep creates a new CheckDuplicateStep
//
// Parameters:
//   - store: The store instance (implements store.Store interface)
//
// The api_resource_kind is automatically extracted from the request context
// by the apiresource interceptor during request handling.
func NewCheckDuplicateStep[T proto.Message](s store.Store) *CheckDuplicateStep[T] {
	return &CheckDuplicateStep[T]{
		store: s,
	}
}

// Name returns the step name
func (s *CheckDuplicateStep[T]) Name() string {
	return "CheckDuplicate"
}

// Execute checks for duplicate resources by slug within the same org
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

	slug := metadata.Slug
	org := metadata.Org

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	existing, found, err := FindResourceBySlug[T](ctx.Context(), s.store, kind, slug, org)
	if err != nil {
		return fmt.Errorf("failed to check for duplicates: %w", err)
	}

	if found {
		existingMetadata := any(existing).(HasMetadata).GetMetadata()
		kindName, _ := apiresource.GetKindName(kind)
		return fmt.Errorf("%s with slug '%s' already exists in org '%s' (id: %s)", kindName, slug, existingMetadata.Org, existingMetadata.Id)
	}

	return nil
}
