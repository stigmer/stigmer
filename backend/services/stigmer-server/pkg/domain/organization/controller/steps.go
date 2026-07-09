package organization

import (
	"errors"
	"fmt"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// Organization is the single resource whose id equals its slug. Every other
// kind mints a prefixed ULID (agt_…, wfl_…) in the shared BuildNewStateStep;
// Organization deliberately deviates because it is the immutable, globally
// unique tenancy root that every child resource references by slug (metadata.org).
// The two steps below implement that deviation and its uniqueness guarantee.
// They mirror cloud's OrganizationCreateHandler (CopySlugToId + CheckDuplicate)
// step-for-step so both editions produce an identical contract.

// CheckOrgDuplicateStep rejects a create when an organization already exists with
// the same slug, checked GLOBALLY by id.
//
// Organizations use their slug as their id (see CopySlugToIdStep), so slug
// uniqueness must be global — not org-scoped like every other resource. The
// generic CheckDuplicateStep scopes its lookup by metadata.org, which is only
// safe for organizations because callers leave it empty; a direct API caller
// that set a non-empty metadata.org could otherwise slip a colliding slug past
// the scoped check and, because the store persists by id with upsert semantics,
// silently overwrite the existing organization. Checking existence by id
// (== the resolved slug) closes that hole and mirrors cloud's
// OrganizationCreateHandler.CheckDuplicate (organizationRepo.findById(resolvedSlug)).
//
// Runs after ResolveSlug (slug is set) and before BuildNewState/CopySlugToId
// (the id is not yet minted), so it keys on the slug value that will become the id.
type CheckOrgDuplicateStep struct {
	store store.Store
}

func newCheckOrgDuplicateStep(s store.Store) *CheckOrgDuplicateStep {
	return &CheckOrgDuplicateStep{store: s}
}

// Name returns the step name.
func (s *CheckOrgDuplicateStep) Name() string {
	return "CheckDuplicate"
}

// Execute checks for an existing organization with the same slug (by id).
func (s *CheckOrgDuplicateStep) Execute(ctx *pipeline.RequestContext[*organizationv1.Organization]) error {
	metadata := ctx.NewState().GetMetadata()
	if metadata == nil {
		return grpclib.InternalError(errors.New("organization metadata is nil"), "duplicate check")
	}

	// ResolveSlug runs before this step, so an empty slug here is a server-side
	// pipeline-ordering bug, not bad client input.
	slug := metadata.GetSlug()
	if slug == "" {
		return grpclib.InternalError(errors.New("organization slug is empty"), "duplicate check")
	}

	var existing organizationv1.Organization
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_organization, slug, &existing)
	switch {
	case err == nil:
		return grpclib.AlreadyExistsError("Organization", fmt.Sprintf("slug '%s'", slug))
	case errors.Is(err, store.ErrNotFound):
		return nil
	default:
		return grpclib.InternalError(err, "failed to check for duplicate organization")
	}
}

// CopySlugToIdStep sets metadata.id to metadata.slug.
//
// This is the deliberate id == slug exception for the tenancy root. It runs
// after BuildNewState (which mints a throwaway org_<ulid>) and overwrites that
// id with the slug, exactly mirroring cloud's OrganizationCreateHandler.CopySlugToId.
type CopySlugToIdStep struct{}

func newCopySlugToIdStep() *CopySlugToIdStep {
	return &CopySlugToIdStep{}
}

// Name returns the step name.
func (s *CopySlugToIdStep) Name() string {
	return "CopySlugToId"
}

// Execute overwrites metadata.id with metadata.slug.
func (s *CopySlugToIdStep) Execute(ctx *pipeline.RequestContext[*organizationv1.Organization]) error {
	metadata := ctx.NewState().GetMetadata()
	if metadata == nil {
		return grpclib.InternalError(errors.New("organization metadata is nil"), "copy slug to id")
	}

	// ResolveSlug guarantees a non-empty slug upstream; an empty slug here is a
	// pipeline-ordering bug, not bad client input.
	if metadata.GetSlug() == "" {
		return grpclib.InternalError(errors.New("organization slug is empty"), "copy slug to id")
	}

	metadata.Id = metadata.GetSlug()
	return nil
}
