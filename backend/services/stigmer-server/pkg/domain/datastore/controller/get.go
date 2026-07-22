package controller

import (
	"context"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves a datastore by ID (the resource — spec + status; record
// reads go through the record query controller).
func (c *DatastoreController) Get(ctx context.Context, id *apiresource.ApiResourceId) (*datastorev1.Datastore, error) {
	reqCtx := pipeline.NewRequestContext(ctx, id)

	p := pipeline.NewPipeline[*apiresource.ApiResourceId]("datastore-get").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceId]()).
		AddStep(steps.NewLoadTargetStep[*apiresource.ApiResourceId, *datastorev1.Datastore](c.store)).
		Build()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.Get(steps.TargetResourceKey).(*datastorev1.Datastore), nil
}
