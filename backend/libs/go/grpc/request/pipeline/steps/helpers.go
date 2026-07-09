package steps

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// RequireOrgForReference enforces that a getByReference lookup carries an org
// when the resource kind is organization-scoped.
//
// For AUTHORIZATION_SCOPE_TYPE_ORGANIZATION kinds a slug is unique only WITHIN
// an org (the same slug can exist in many orgs), so a reference with no org is
// under-specified — resolving it globally would cross tenant boundaries. The
// proto contract already treats stored references as absolute (org populated);
// an empty org is a write-time relative form, never a read-time global search.
// This mirrors the cloud edition (which rejects the same input) and derives the
// rule from the same kind_meta authorization config both editions share — the
// same single-source-of-truth pattern as apiresource.DefaultVisibilityFor.
//
// Non-org-scoped kinds (execution_context, organization — OWNER_ONLY) are
// exempt: their slugs are owner- or globally-unique, so an empty org is valid.
//
// This guard belongs at the getByReference request boundary. It deliberately
// does NOT live in the low-level slug finders (FindResourceBySlug and the
// per-step findBySlug helpers), which internal resolvers legitimately call with
// a relative (possibly empty) org — e.g. resolving an MCP-server reference while
// building an agent's execution context.
func RequireOrgForReference(kind apiresourcekind.ApiResourceKind, org string) error {
	if org != "" {
		return nil
	}
	meta, err := apiresource.GetKindMeta(kind)
	if err != nil {
		return grpclib.InternalError(err, "failed to resolve kind metadata for reference org check")
	}
	if meta.GetAuthorization().GetScopeType() == apiresourcekind.AuthorizationScopeType_AUTHORIZATION_SCOPE_TYPE_ORGANIZATION {
		// Match the cloud edition's message verbatim (e.g. "org is required for
		// Project lookup") so the cross-edition error contract is identical.
		return grpclib.InvalidArgumentError("org is required for %s lookup", meta.GetName())
	}
	return nil
}

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

// FindResourceByLabelAndOrg searches for a resource whose metadata carries a
// specific label AND belongs to a specific organization.
//
// This is the building block for org-scoped uniqueness guards keyed on labels
// (e.g. "at most one personal environment — label stigmer.ai/personal=true —
// per org"). It scans all resources of the given kind and returns the first
// whose label value and org BOTH match.
//
// Org semantics differ deliberately from FindResourceBySlug. There, org is an
// optional narrowing filter over an already-unique slug, so an empty org means
// "match any org". Here, (labelKey/labelValue, org) together form the composite
// lookup key and org is matched EXACTLY — an empty org matches only resources
// whose org is also empty. This is load-bearing, not stylistic:
//   - metadata.org is proto-unconstrained on create (ApiResourceMetadata.org is
//     a bare string with no required/min_len), so an empty org is a reachable
//     input, not a theoretical one.
//   - For a uniqueness guard, treating an empty org as a wildcard would make an
//     empty-org resource collide with matching resources in every org, which is
//     exactly the cross-tenant over-matching this helper exists to prevent.
//
// Returns:
//   - resource: The found resource (zero value if not found)
//   - found: true if a matching resource was found
//   - error: Database error (does NOT return error if resource not found)
//
// Usage:
//
//	env, found, err := steps.FindResourceByLabelAndOrg[*environmentv1.Environment](
//	    ctx, store, kind, "stigmer.ai/personal", "true", "acme")
//	if err != nil {
//	    return err // database error
//	}
//	if found {
//	    // a personal environment already exists in org "acme"
//	}
func FindResourceByLabelAndOrg[T proto.Message](ctx context.Context, s store.Store, kind apiresourcekind.ApiResourceKind, labelKey, labelValue, org string) (T, bool, error) {
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

		metadataResource, ok := any(resource).(HasMetadata)
		if !ok {
			continue
		}

		metadata := metadataResource.GetMetadata()
		if metadata == nil {
			continue
		}

		if metadata.GetLabels()[labelKey] == labelValue && metadata.GetOrg() == org {
			return resource, true, nil
		}
	}

	return zero, false, nil
}
