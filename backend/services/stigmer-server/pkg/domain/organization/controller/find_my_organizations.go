package organization

import (
	"context"

	"github.com/rs/zerolog/log"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
)

// FindMyOrganizations returns all organizations the authenticated user belongs to.
//
// In OSS (single user, no IAM), this returns all organizations. No pipeline
// is needed since the input is google.protobuf.Empty — there is nothing to
// validate, and the operation is a simple store list.
//
// In Stigmer Cloud, this method queries IAM Policy to filter organizations
// by the caller's access. The OSS version omits this entirely.
func (c *OrganizationController) FindMyOrganizations(ctx context.Context, _ *emptypb.Empty) (*organizationv1.Organizations, error) {
	data, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_organization)
	if err != nil {
		log.Error().Err(err).Msg("Failed to list organizations")
		return nil, grpclib.InternalError(err, "failed to list organizations")
	}

	orgs := make([]*organizationv1.Organization, 0, len(data))
	for _, d := range data {
		org := &organizationv1.Organization{}
		if err := proto.Unmarshal(d, org); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal organization, skipping")
			continue
		}
		orgs = append(orgs, org)
	}

	log.Info().Int("count", len(orgs)).Msg("Loaded organizations for user")

	return &organizationv1.Organizations{Entries: orgs}, nil
}
