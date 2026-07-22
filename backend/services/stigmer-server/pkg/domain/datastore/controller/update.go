package controller

import (
	"context"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	domainsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/controller/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Update updates an existing datastore. Updates are full spec replaces;
// the gating schema-sync step diffs the declared schema against the
// loaded existing spec and applies the additive-plus change matrix — no
// transition silently destroys or nulls record data, and a rejected
// sync restores the prior schema.
//
// Pipeline:
//  1. ValidateProto     - proto field constraints
//  2. ResolveSlug       - slug from metadata.name
//  3. LoadExisting      - load prior resource (the sync diff base)
//  4. ValidateSpec      - cross-field domain validation
//  5. BuildUpdateState  - merge, preserve immutables + status, audit
//  6. Persist           - save resource
//  7. SchemaSync        - GATING: change matrix, DDL, seed-once skip,
//     sync report (rejection restores the prior resource)
//  8. IndexSearch       - search index
func (c *DatastoreController) Update(ctx context.Context, datastore *datastorev1.Datastore) (*datastorev1.Datastore, error) {
	reqCtx := pipeline.NewRequestContext(ctx, datastore)

	if err := c.buildUpdatePipeline().Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *DatastoreController) buildUpdatePipeline() *pipeline.Pipeline[*datastorev1.Datastore] {
	return pipeline.NewPipeline[*datastorev1.Datastore]("datastore-update").
		AddStep(steps.NewValidateProtoStep[*datastorev1.Datastore]()).
		AddStep(steps.NewResolveSlugStep[*datastorev1.Datastore]()).
		AddStep(steps.NewLoadExistingStep[*datastorev1.Datastore](c.store)).
		AddStep(domainsteps.NewValidateSpecStep()).
		AddStep(steps.NewBuildUpdateStateStep[*datastorev1.Datastore]()).
		AddStep(steps.NewPersistStep[*datastorev1.Datastore](c.store)).
		AddStep(domainsteps.NewSchemaSyncStep(c.store, c.recordStore)).
		AddStep(steps.NewIndexSearchStep[*datastorev1.Datastore](c.store, &extractor.DatastoreExtractor{})).
		Build()
}
