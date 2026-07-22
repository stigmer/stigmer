package controller

import (
	"context"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	domainsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/controller/steps"
)

// Delete deletes a datastore and every record it holds — the only path
// that destroys collections (record tools never delete structures).
//
// Two guards (DD-003), in order:
//  1. Agent-reference block: a datastore referenced by any agent's
//     datastore_usages cannot be deleted, force or not — the usage edge
//     is authorization-bearing and must never dangle.
//  2. Non-empty acknowledgment: deleting a datastore holding records
//     requires force; without it the error reports the record and
//     collection counts that would be destroyed.
//
// Pipeline:
//  1. ValidateProto          - input constraints
//  2. LoadExistingForDelete  - load the datastore (pre-delete snapshot)
//  3. GuardAgentReferences   - block on datastore_usages (never forceable)
//  4. GuardNonEmpty          - force acknowledgment for held records
//  5. DropCollectionTables   - destroy the record substrate
//  6. DeleteResource         - remove the resource row
//  7. DeleteSearchIndex      - remove from search
func (c *DatastoreController) Delete(ctx context.Context, input *apiresource.ApiResourceDeleteInput) (*datastorev1.Datastore, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// ApiResourceDeleteInput carries ResourceId (not Value), so seed the
	// context key the load step expects.
	reqCtx.Set(steps.ResourceIdKey, input.ResourceId)

	if err := c.buildDeletePipeline().Execute(reqCtx); err != nil {
		return nil, err
	}

	deleted := reqCtx.Get(steps.ExistingResourceKey)
	if deleted == nil {
		return nil, grpclib.InternalError(nil, "deleted datastore not found in context")
	}
	return deleted.(*datastorev1.Datastore), nil
}

func (c *DatastoreController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceDeleteInput] {
	return pipeline.NewPipeline[*apiresource.ApiResourceDeleteInput]("datastore-delete").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceDeleteInput]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceDeleteInput, *datastorev1.Datastore](c.store)).
		AddStep(domainsteps.NewGuardAgentReferencesStep(c.store)).
		AddStep(domainsteps.NewGuardNonEmptyStep(c.recordStore)).
		AddStep(domainsteps.NewDropCollectionTablesStep(c.recordStore)).
		AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceDeleteInput](c.store)).
		AddStep(steps.NewDeleteSearchIndexStep[*apiresource.ApiResourceDeleteInput](c.store)).
		Build()
}
