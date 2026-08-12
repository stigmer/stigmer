package controller

import (
	"context"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	domainsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/controller/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Create creates a new datastore and materializes its record substrate.
//
// Pipeline (OSS — excludes the cloud-only Authorize/IamPolicies/Publish
// steps):
//  1. ValidateProto      - proto field constraints
//  2. ResolveSlug        - slug from metadata.name
//  3. CheckDuplicate     - no duplicate slug in the org
//  4. ValidateSpec       - cross-field domain validation (names, roles,
//     defaults, timezone, constraint references, CEL compilation)
//  5. EnforceOrgQuota    - max datastores per org
//  6. BuildNewState      - ID (dst_<ulid>), audit fields, default visibility
//  7. Persist            - save resource
//  8. SchemaSync         - GATING: materialize tables/indexes, seed-once,
//     write sync report to status (rejection rolls the create back)
//  9. IndexSearch        - search index
func (c *DatastoreController) Create(ctx context.Context, datastore *datastorev1.Datastore) (*datastorev1.Datastore, error) {
	reqCtx := pipeline.NewRequestContext(ctx, datastore)

	if err := c.buildCreatePipeline().Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *DatastoreController) buildCreatePipeline() *pipeline.Pipeline[*datastorev1.Datastore] {
	return pipeline.NewPipeline[*datastorev1.Datastore]("datastore-create").
		AddStep(steps.NewValidateProtoStep[*datastorev1.Datastore]()).
		AddStep(steps.NewResolveSlugStep[*datastorev1.Datastore]()).
		AddStep(steps.NewCheckDuplicateStep[*datastorev1.Datastore](c.store)).
		AddStep(domainsteps.NewValidateSpecStep()).
		AddStep(domainsteps.NewEnforceOrgQuotaStep(c.store)).
		AddStep(steps.NewBuildNewStateStep[*datastorev1.Datastore]()).
		AddStep(steps.NewPersistStep[*datastorev1.Datastore](c.store)).
		AddStep(domainsteps.NewSchemaSyncStep(c.store, c.recordStore)).
		AddStep(steps.NewIndexSearchStep[*datastorev1.Datastore](c.store, &extractor.DatastoreExtractor{})).
		Build()
}
