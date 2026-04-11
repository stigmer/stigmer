package oauthapp

import (
	"context"
	"sort"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	oauthsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/oauthapp/controller/steps"
	"google.golang.org/protobuf/proto"
)

const listResultKey = "listResult"

// ListByOrg retrieves all OAuthApps belonging to an organization.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (org is required)
//  2. ListByOrgStep - Load all OAuthApps, filter by org, redact secrets
//
// Results are sorted by created_at descending (newest first).
// Each entry has its client_secret redacted with ***REDACTED***.
//
// Note: Unlike Stigmer Cloud, OSS excludes:
//   - Authorization filtering (no multi-user auth -- returns all matching)
//   - Pagination (returns all matching results; typically 1-5 per org)
func (c *OAuthAppController) ListByOrg(ctx context.Context, req *oauthappv1.ListOAuthAppsByOrgInput) (*oauthappv1.OAuthApps, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListByOrgPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(listResultKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "OAuthApp list not found in context")
	}

	return list.(*oauthappv1.OAuthApps), nil
}

func (c *OAuthAppController) buildListByOrgPipeline() *pipeline.Pipeline[*oauthappv1.ListOAuthAppsByOrgInput] {
	return pipeline.NewPipeline[*oauthappv1.ListOAuthAppsByOrgInput]("oauthapp-list-by-org").
		AddStep(steps.NewValidateProtoStep[*oauthappv1.ListOAuthAppsByOrgInput]()). // 1. Validate input
		AddStep(newListByOrgStep(c.store)).                                          // 2. Load, filter, redact
		Build()
}

// listByOrgStep loads all OAuthApps and filters by organization.
//
// This step:
//  1. Lists all OAuthApp resources from the store
//  2. Filters by metadata.org matching the requested org
//  3. Redacts client_secret on each entry
//  4. Sorts by created_at descending (newest first)
//  5. Stores the result in pipeline context
type listByOrgStep struct {
	store store.Store
}

func newListByOrgStep(store store.Store) *listByOrgStep {
	return &listByOrgStep{store: store}
}

func (s *listByOrgStep) Name() string {
	return "ListByOrg"
}

func (s *listByOrgStep) Execute(ctx *pipeline.RequestContext[*oauthappv1.ListOAuthAppsByOrgInput]) error {
	org := ctx.Input().GetOrg()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_oauth_app)
	if err != nil {
		return grpclib.InternalError(err, "failed to list OAuthApps")
	}

	apps := make([]*oauthappv1.OAuthApp, 0, len(resources))
	for _, data := range resources {
		app := &oauthappv1.OAuthApp{}
		if err := proto.Unmarshal(data, app); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal OAuthApp, skipping")
			continue
		}

		if app.GetMetadata().GetOrg() != org {
			continue
		}

		oauthsteps.RedactOAuthApp(app)
		apps = append(apps, app)
	}

	sort.Slice(apps, func(i, j int) bool {
		ti := apps[i].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		tj := apps[j].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		if ti == nil || tj == nil {
			return ti != nil
		}
		if ti.GetSeconds() != tj.GetSeconds() {
			return ti.GetSeconds() > tj.GetSeconds()
		}
		return ti.GetNanos() > tj.GetNanos()
	})

	log.Info().
		Str("org", org).
		Int("matchCount", len(apps)).
		Msg("Listed OAuthApps by organization")

	ctx.Set(listResultKey, &oauthappv1.OAuthApps{
		Entries: apps,
	})

	return nil
}
