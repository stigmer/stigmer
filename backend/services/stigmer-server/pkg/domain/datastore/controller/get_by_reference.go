package controller

import (
	"context"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// GetByReference resolves an org-scoped reference (org/slug) to the
// datastore resource. Datastore is org-scoped, so the reference must
// carry an org (RequireOrgForReference inside the load step).
func (c *DatastoreController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*datastorev1.Datastore, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := pipeline.NewPipeline[*apiresource.ApiResourceReference]("datastore-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).
		AddStep(steps.NewLoadByReferenceStep[*datastorev1.Datastore](c.store)).
		Build()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.Get(steps.TargetResourceKey).(*datastorev1.Datastore), nil
}
