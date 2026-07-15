package channelapp

import (
	"context"
	"sort"

	"github.com/rs/zerolog/log"
	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const listResultKey = "listResult"

// ListByOrg retrieves all ChannelApps belonging to an organization,
// sorted by created_at descending, with every entry's secret fields
// redacted. No pagination — the set is small by nature (typically one app
// per provider per org), the OAuthApp listByOrg posture.
func (c *ChannelAppController) ListByOrg(ctx context.Context, req *channelappv1.ListChannelAppsByOrgInput) (*channelappv1.ChannelApps, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	if err := c.buildListByOrgPipeline().Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(listResultKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "ChannelApp list not found in context")
	}

	return list.(*channelappv1.ChannelApps), nil
}

func (c *ChannelAppController) buildListByOrgPipeline() *pipeline.Pipeline[*channelappv1.ListChannelAppsByOrgInput] {
	return pipeline.NewPipeline[*channelappv1.ListChannelAppsByOrgInput]("channelapp-list-by-org").
		AddStep(steps.NewValidateProtoStep[*channelappv1.ListChannelAppsByOrgInput]()).
		AddStep(newListByOrgStep(c.store)).
		Build()
}

// listByOrgStep loads all ChannelApps, filters by org, redacts secrets,
// and sorts newest-first.
type listByOrgStep struct {
	store store.Store
}

func newListByOrgStep(store store.Store) *listByOrgStep {
	return &listByOrgStep{store: store}
}

func (s *listByOrgStep) Name() string {
	return "ListByOrg"
}

func (s *listByOrgStep) Execute(ctx *pipeline.RequestContext[*channelappv1.ListChannelAppsByOrgInput]) error {
	org := ctx.Input().GetOrg()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_channel_app)
	if err != nil {
		return grpclib.InternalError(err, "failed to list ChannelApps")
	}

	apps := make([]*channelappv1.ChannelApp, 0, len(resources))
	for _, data := range resources {
		app := &channelappv1.ChannelApp{}
		if err := proto.Unmarshal(data, app); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal ChannelApp, skipping")
			continue
		}

		if app.GetMetadata().GetOrg() != org {
			continue
		}

		RedactChannelApp(app)
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
		Msg("Listed ChannelApps by organization")

	ctx.Set(listResultKey, &channelappv1.ChannelApps{Entries: apps})
	return nil
}
