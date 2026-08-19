package memory

import (
	"context"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves a memory by ID using the pipeline pattern.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from MemoryId.Value wrapper
//  3. LoadTarget - Load the memory from the database
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
// requires can_view — FGA subject-only: only the person a memory is
// about can read it).
func (c *MemoryController) Get(ctx context.Context, memoryId *memoryv1.MemoryId) (*memoryv1.Memory, error) {
	reqCtx := pipeline.NewRequestContext(ctx, memoryId)

	p := c.buildGetPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	target := reqCtx.Get(steps.TargetResourceKey)
	if target == nil {
		return nil, grpclib.InternalError(nil, "target memory not found in context")
	}

	return target.(*memoryv1.Memory), nil
}

func (c *MemoryController) buildGetPipeline() *pipeline.Pipeline[*memoryv1.MemoryId] {
	return pipeline.NewPipeline[*memoryv1.MemoryId]("memory-get").
		AddStep(steps.NewValidateProtoStep[*memoryv1.MemoryId]()).
		AddStep(steps.NewExtractResourceIdStep[*memoryv1.MemoryId]()).
		AddStep(steps.NewLoadTargetStep[*memoryv1.MemoryId, *memoryv1.Memory](c.store)).
		Build()
}
