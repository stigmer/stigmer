package memory

import (
	"context"
	"sort"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

const listResultKey = "listResult"

// List retrieves memories in an organization, newest first.
//
// Ordering is chronological only; grouping pending proposals first is
// the console's presentation concern (DD-005 D4), deliberately not an
// RPC parameter at the kind's dozens-of-records scale.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (org is required)
//  2. ListMemoriesByOrg - Load all memories, filter by org
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization filtering (single user — every record is the caller's;
//   cloud filters to can_view via FGA, which resolves to the subject)
// - Pagination (returns all matching results)
func (c *MemoryController) List(ctx context.Context, req *memoryv1.ListMemoriesRequest) (*memoryv1.MemoryList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(listResultKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "memory list not found in context")
	}

	return list.(*memoryv1.MemoryList), nil
}

func (c *MemoryController) buildListPipeline() *pipeline.Pipeline[*memoryv1.ListMemoriesRequest] {
	return pipeline.NewPipeline[*memoryv1.ListMemoriesRequest]("memory-list").
		AddStep(steps.NewValidateProtoStep[*memoryv1.ListMemoriesRequest]()).
		AddStep(&listMemoriesByOrgStep{controller: c}).
		Build()
}

// listMemoriesByOrgStep loads all memories and filters by org, sorted by
// created_at descending (newest first) — the schedule list posture.
type listMemoriesByOrgStep struct {
	controller *MemoryController
}

func (s *listMemoriesByOrgStep) Name() string {
	return "ListMemoriesByOrg"
}

func (s *listMemoriesByOrgStep) Execute(ctx *pipeline.RequestContext[*memoryv1.ListMemoriesRequest]) error {
	org := ctx.Input().GetOrg()

	resources, err := s.controller.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_memory)
	if err != nil {
		return grpclib.InternalError(err, "failed to list memories")
	}

	memories := make([]*memoryv1.Memory, 0, len(resources))
	for _, data := range resources {
		memory, ok := unmarshalMemory(data)
		if !ok {
			continue
		}
		if memory.GetMetadata().GetOrg() != org {
			continue
		}
		memories = append(memories, memory)
	}

	sort.Slice(memories, func(i, j int) bool {
		ti := memories[i].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		tj := memories[j].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		if ti == nil || tj == nil {
			return ti != nil
		}
		if ti.GetSeconds() != tj.GetSeconds() {
			return ti.GetSeconds() > tj.GetSeconds()
		}
		return ti.GetNanos() > tj.GetNanos()
	})

	ctx.Set(listResultKey, &memoryv1.MemoryList{
		TotalCount: int32(len(memories)),
		Items:      memories,
	})

	return nil
}
