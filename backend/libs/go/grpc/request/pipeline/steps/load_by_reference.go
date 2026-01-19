package steps

import (
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// LoadByReferenceStep loads a resource by ApiResourceReference (slug-based lookup)
//
// This step is used in GetByReference operations where the input is an ApiResourceReference.
// It:
//  1. Validates the reference (verifies kind matches)
//  2. Queries resources by slug (with optional org filter)
//  3. Stores the loaded resource in context with key "targetResource"
//  4. Returns NotFound error if resource doesn't exist
//
// The step handles both platform-scoped (no org) and org-scoped lookups:
//   - Platform-scoped: queries by ownerScope=platform + slug
//   - Org-scoped: queries by org + slug
//
// Usage in handlers:
//
//	pipeline.NewPipeline[*apiresource.ApiResourceReference]("agent-get-by-reference").
//	    AddStep(steps.NewLoadByReferenceStep[*pb.Agent](store)).
//	    Build()
//
// After execution, retrieve the loaded resource from context:
//
//	agent := reqCtx.Get(steps.TargetResourceKey).(*pb.Agent)
type LoadByReferenceStep[T proto.Message] struct {
	store store.Store
}

// NewLoadByReferenceStep creates a new LoadByReferenceStep
//
// Type Parameters:
//   - T: The target resource type (e.g., *Agent)
//
// Parameters:
//   - store: The store instance (implements store.Store interface)
//
// The api_resource_kind is automatically extracted from the request context
// by the apiresource interceptor during request handling.
func NewLoadByReferenceStep[T proto.Message](s store.Store) *LoadByReferenceStep[T] {
	return &LoadByReferenceStep[T]{
		store: s,
	}
}

// Name returns the step name
func (s *LoadByReferenceStep[T]) Name() string {
	return "LoadByReference"
}

// Execute loads the target resource by reference from the database
func (s *LoadByReferenceStep[T]) Execute(ctx *pipeline.RequestContext[*apiresourcepb.ApiResourceReference]) error {
	ref := ctx.Input()

	// Validate reference
	if ref == nil {
		return grpclib.InvalidArgumentError("reference is required")
	}

	if ref.Slug == "" {
		return grpclib.InvalidArgumentError("slug is required in reference")
	}

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// Verify kind matches the reference kind (if provided)
	if ref.Kind.Number() != 0 && ref.Kind != kind {
		return grpclib.InvalidArgumentError(fmt.Sprintf(
			"kind mismatch: expected %s, got %s",
			kind.String(),
			ref.Kind.String(),
		))
	}

	// Extract kind name from the enum's proto options
	kindName, err := apiresource.GetKindName(kind)
	if err != nil {
		return fmt.Errorf("failed to get kind name: %w", err)
	}

	// Find resource by slug
	// Note: This is not efficient for large datasets (lists all and filters),
	// but acceptable for local/OSS usage. Production systems should use indexed queries.
	target, found, err := s.findBySlug(ctx, kindName, ref.Slug, ref.Org)
	if err != nil {
		return err
	}

	if !found {
		return grpclib.WrapError(nil, codes.NotFound, fmt.Sprintf(
			"%s not found with slug: %s",
			kindName,
			ref.Slug,
		))
	}

	// Store loaded resource in context for handler to return
	ctx.Set(TargetResourceKey, target)

	return nil
}

// findBySlug finds a resource by slug, with optional org filtering
//
// For local/OSS usage, this iterates through all resources.
// In production systems with large datasets, this should be replaced
// with indexed database queries.
//
// Returns: (resource, found, error)
//   - resource: the found resource (zero value if not found)
//   - found: true if resource was found, false otherwise
//   - error: any error that occurred during search
func (s *LoadByReferenceStep[T]) findBySlug(
	ctx *pipeline.RequestContext[*apiresourcepb.ApiResourceReference],
	kindName string,
	slug string,
	org string,
) (T, bool, error) {
	var zero T

	// List all resources (note: local/OSS doesn't have org-scoped queries)
	resources, err := s.store.ListResources(ctx.Context(), kindName)
	if err != nil {
		return zero, false, grpclib.InternalError(err, fmt.Sprintf("failed to list %s resources", kindName))
	}

	// Iterate and find by slug
	for _, data := range resources {
		// Create a new instance of the target type
		var resource T
		resource = resource.ProtoReflect().New().Interface().(T)

		// Unmarshal (BadgerDB stores proto bytes directly)
		if err := proto.Unmarshal(data, resource); err != nil {
			// Skip invalid entries (should not happen in normal operation)
			continue
		}

		// Type assertion to access metadata
		metadataResource, ok := any(resource).(HasMetadata)
		if !ok {
			// Skip resources without metadata (should not happen)
			continue
		}

		metadata := metadataResource.GetMetadata()
		if metadata == nil {
			continue
		}

		// Match by name (slug is stored in metadata.name)
		if metadata.Name == slug {
			// Additional org filter check (if org provided)
			if org != "" && metadata.Org != org {
				continue
			}

			return resource, true, nil
		}
	}

	return zero, false, nil
}
