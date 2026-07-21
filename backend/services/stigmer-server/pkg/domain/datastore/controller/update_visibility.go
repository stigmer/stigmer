package controller

import (
	"context"
	"fmt"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateVisibility updates a datastore's visibility — a targeted
// metadata update touching only metadata.visibility.
//
// Datastores cap out at org visibility (kind VisibilityConfig:
// supports_org only): business records must never be resolvable across
// the org boundary. Visibility governs human administrative reach only —
// no record-RPC path consults it; record access is governed solely by
// the spec's authorization block and agent datastore_usages.
func (c *DatastoreController) UpdateVisibility(
	ctx context.Context,
	input *apiresourcepb.UpdateVisibilityInput,
) (*datastorev1.Datastore, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := pipeline.NewPipeline[*apiresourcepb.UpdateVisibilityInput]("datastore-update-visibility").
		AddStep(steps.NewValidateProtoStep[*apiresourcepb.UpdateVisibilityInput]()).
		AddStep(&setDatastoreVisibilityStep{store: c.store}).
		Build()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.Get(updateVisibilityResultKey).(*datastorev1.Datastore), nil
}

const updateVisibilityResultKey = "updateVisibilityDatastore"

// setDatastoreVisibilityStep loads the datastore, validates the level
// against the kind's VisibilityConfig, sets it, persists, and reindexes.
type setDatastoreVisibilityStep struct {
	store store.Store
}

func (s *setDatastoreVisibilityStep) Name() string {
	return "SetDatastoreVisibility"
}

func (s *setDatastoreVisibilityStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()
	kind := apiresourcekind.ApiResourceKind_datastore

	ds := &datastorev1.Datastore{}
	if err := s.store.GetResource(ctx.Context(), kind, input.GetResourceId(), ds); err != nil {
		return grpclib.NotFoundError("datastore", input.GetResourceId())
	}

	requested := input.GetVisibility()
	supported, err := apiresource.SupportsVisibility(kind, requested)
	if err != nil {
		return grpclib.InternalError(err, "failed to resolve datastore visibility config")
	}
	if !supported {
		return grpclib.InvalidArgumentError(
			"visibility level %s is not supported for datastores - business records never leave the org boundary (supported: private, org)",
			requested.String())
	}

	ds.Metadata.Visibility = requested
	if err := steps.SetAuditFieldsForUpdate(ds); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	if err := s.store.SaveResource(ctx.Context(), kind, ds.GetMetadata().GetId(), ds); err != nil {
		return grpclib.InternalError(err, "failed to save datastore")
	}

	ext := &extractor.DatastoreExtractor{}
	if entry := ext.GetSearchIndexEntry(ds); entry != nil {
		// Best-effort, matching the platform's search-index posture for
		// metadata-only updates.
		_ = s.store.UpsertSearchIndex(ctx.Context(), kind, ds.GetMetadata().GetId(), entry)
	}

	ctx.Set(updateVisibilityResultKey, ds)
	return nil
}
