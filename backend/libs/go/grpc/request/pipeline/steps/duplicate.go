package steps

import (
	"errors"
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
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

	// Type assertion to access metadata. These invariants are established by
	// earlier pipeline steps, so a failure here is a server-side programming
	// error, not bad client input — hence Internal, not InvalidArgument.
	metadataResource, ok := any(resource).(HasMetadata)
	if !ok {
		return grpclib.InternalError(errors.New("resource does not implement HasMetadata interface"), "duplicate check")
	}

	metadata := metadataResource.GetMetadata()
	if metadata == nil {
		return grpclib.InternalError(errors.New("resource metadata is nil"), "duplicate check")
	}

	// Verify slug is set (ResolveSlugStep runs before this step)
	if metadata.Slug == "" {
		return grpclib.InternalError(errors.New("resource slug is empty"), "duplicate check")
	}

	slug := metadata.Slug
	org := metadata.Org

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	existing, found, err := FindResourceBySlug[T](ctx.Context(), s.store, kind, slug, org)
	if err != nil {
		return grpclib.InternalError(err, "failed to check for duplicates")
	}

	if found {
		existingMetadata := any(existing).(HasMetadata).GetMetadata()
		kindName, _ := apiresource.GetKindName(kind)
		return grpclib.AlreadyExistsError(kindName, fmt.Sprintf("slug '%s' in org '%s' (id: %s)", slug, existingMetadata.Org, existingMetadata.Id))
	}

	return nil
}
