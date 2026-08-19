package memory

import (
	"context"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes a memory permanently, in ANY lifecycle state — the
// any-state guarantee is load-bearing for the trust story: "delete this
// one" must never be refused on lifecycle grounds (DD-004). Deleting a
// confirmed memory is how consent is revoked; past executions keep their
// immutable recalled_memories snapshots (DD-006 D6).
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from MemoryId.Value wrapper
//  3. LoadExistingForDelete - Load the memory (stored in context for return)
//  4. DeleteResource - Delete the memory from the database
//
// No search-index cleanup: memory is not_search_indexed.
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
// requires can_delete on the memory — FGA subject-only).
//
// The deleted memory is returned for audit trail purposes (gRPC convention).
func (c *MemoryController) Delete(ctx context.Context, memoryId *memoryv1.MemoryId) (*memoryv1.Memory, error) {
	reqCtx := pipeline.NewRequestContext(ctx, memoryId)

	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	deleted := reqCtx.Get(steps.ExistingResourceKey)
	if deleted == nil {
		return nil, grpclib.InternalError(nil, "deleted memory not found in context")
	}

	return deleted.(*memoryv1.Memory), nil
}

func (c *MemoryController) buildDeletePipeline() *pipeline.Pipeline[*memoryv1.MemoryId] {
	return pipeline.NewPipeline[*memoryv1.MemoryId]("memory-delete").
		AddStep(steps.NewValidateProtoStep[*memoryv1.MemoryId]()).
		AddStep(steps.NewExtractResourceIdStep[*memoryv1.MemoryId]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*memoryv1.MemoryId, *memoryv1.Memory](c.store)).
		AddStep(steps.NewDeleteResourceStep[*memoryv1.MemoryId](c.store)).
		Build()
}
