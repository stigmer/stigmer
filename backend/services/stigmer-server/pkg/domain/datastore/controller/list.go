package controller

import (
	"context"
	"sort"

	"github.com/rs/zerolog/log"
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const listResultKey = "listResult"

// List retrieves datastores filtered by organization and optional
// labels. OSS returns all matching resources (no authorization
// filtering, no pagination — local single-user).
func (c *DatastoreController) List(ctx context.Context, req *datastorev1.ListDatastoresRequest) (*datastorev1.DatastoreList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := pipeline.NewPipeline[*datastorev1.ListDatastoresRequest]("datastore-list").
		AddStep(steps.NewValidateProtoStep[*datastorev1.ListDatastoresRequest]()).
		AddStep(newListByOrgAndLabelsStep(c.store)).
		Build()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(listResultKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "datastore list not found in context")
	}
	return list.(*datastorev1.DatastoreList), nil
}

// listByOrgAndLabelsStep loads all datastores and filters by org and
// labels (AND semantics), sorted newest-first.
type listByOrgAndLabelsStep struct {
	store store.Store
}

func newListByOrgAndLabelsStep(store store.Store) *listByOrgAndLabelsStep {
	return &listByOrgAndLabelsStep{store: store}
}

func (s *listByOrgAndLabelsStep) Name() string {
	return "ListDatastoresByOrgAndLabels"
}

func (s *listByOrgAndLabelsStep) Execute(ctx *pipeline.RequestContext[*datastorev1.ListDatastoresRequest]) error {
	req := ctx.Input()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_datastore)
	if err != nil {
		return grpclib.InternalError(err, "failed to list datastores")
	}

	datastores := make([]*datastorev1.Datastore, 0, len(resources))
	for _, data := range resources {
		ds := &datastorev1.Datastore{}
		if err := proto.Unmarshal(data, ds); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal datastore, skipping")
			continue
		}
		if ds.GetMetadata().GetOrg() != req.GetOrg() {
			continue
		}
		if !matchesAllLabels(ds.GetMetadata().GetLabels(), req.GetLabels()) {
			continue
		}
		datastores = append(datastores, ds)
	}

	sort.Slice(datastores, func(i, j int) bool {
		ti := datastores[i].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		tj := datastores[j].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		if ti == nil || tj == nil {
			return ti != nil
		}
		if ti.GetSeconds() != tj.GetSeconds() {
			return ti.GetSeconds() > tj.GetSeconds()
		}
		return ti.GetNanos() > tj.GetNanos()
	})

	ctx.Set(listResultKey, &datastorev1.DatastoreList{
		TotalCount: int32(len(datastores)),
		Items:      datastores,
	})
	return nil
}

// matchesAllLabels returns true if resourceLabels contains every entry
// in filterLabels (an empty filter matches everything).
func matchesAllLabels(resourceLabels, filterLabels map[string]string) bool {
	for k, v := range filterLabels {
		if resourceLabels[k] != v {
			return false
		}
	}
	return true
}
