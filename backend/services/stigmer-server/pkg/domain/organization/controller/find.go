package organization

import (
	"context"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"google.golang.org/protobuf/proto"
)

const findResultKey = "findResult"

// Find retrieves organizations with pagination using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate input FindApiResourcesRequest
//  2. ListAllOrganizations - Load all organizations, apply pagination
//
// Note: FindApiResourcesRequest.org is accepted but not used for filtering,
// since organizations are the top-level scope and do not belong to an org.
//
// In a production multi-tenant system, this would enforce admin-level access.
// For OSS local usage, we return all organizations.
func (c *OrganizationController) Find(ctx context.Context, req *apiresource.FindApiResourcesRequest) (*organizationv1.OrganizationList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildFindPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	result := reqCtx.Get(findResultKey).(*organizationv1.OrganizationList)
	return result, nil
}

// buildFindPipeline constructs the pipeline for find operations.
func (c *OrganizationController) buildFindPipeline() *pipeline.Pipeline[*apiresource.FindApiResourcesRequest] {
	return pipeline.NewPipeline[*apiresource.FindApiResourcesRequest]("organization-find").
		AddStep(steps.NewValidateProtoStep[*apiresource.FindApiResourcesRequest]()). // 1. Validate input
		AddStep(newListAllOrganizationsStep(c.store)).                               // 2. List all organizations
		Build()
}

// listAllOrganizationsStep loads all organizations from the database with pagination.
type listAllOrganizationsStep struct {
	store interface {
		ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error)
	}
}

func newListAllOrganizationsStep(store interface {
	ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error)
}) *listAllOrganizationsStep {
	return &listAllOrganizationsStep{store: store}
}

func (s *listAllOrganizationsStep) Name() string {
	return "ListAllOrganizations"
}

func (s *listAllOrganizationsStep) Execute(ctx *pipeline.RequestContext[*apiresource.FindApiResourcesRequest]) error {
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	data, err := s.store.ListResources(ctx.Context(), kind)
	if err != nil {
		log.Error().Err(err).Str("kind", kind.String()).Msg("Failed to list organizations")
		return grpclib.InternalError(err, "failed to list organizations")
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

	req := ctx.Input()
	pageSize := int(req.GetPageSize())
	pageNumber := int(req.GetPageNumber())

	if page := req.GetPage(); page != nil {
		if page.GetSize() > 0 {
			pageSize = int(page.GetSize())
		}
		if page.GetNum() > 0 {
			pageNumber = int(page.GetNum())
		}
	}

	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	if pageNumber <= 0 {
		pageNumber = 1
	}

	totalPages := (len(orgs) + pageSize - 1) / pageSize
	start := (pageNumber - 1) * pageSize
	end := start + pageSize

	if start >= len(orgs) {
		ctx.Set(findResultKey, &organizationv1.OrganizationList{
			TotalPages: int32(totalPages),
			Entries:    []*organizationv1.Organization{},
		})
		return nil
	}
	if end > len(orgs) {
		end = len(orgs)
	}

	log.Info().Int("total", len(orgs)).Int("page", pageNumber).Int("pageSize", pageSize).Msg("Listed organizations")

	ctx.Set(findResultKey, &organizationv1.OrganizationList{
		TotalPages: int32(totalPages),
		Entries:    orgs[start:end],
	})

	return nil
}
