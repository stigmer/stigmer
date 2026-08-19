package memory

import (
	"context"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Create creates a new memory in the proposed state (DD-005 D2).
//
// Pipeline:
//  1. ValidateProto - Proto field constraints (content 1..500 chars)
//  2. ValidateVisibility - Reject unsupported visibility levels (memory
//     has no visibility config: private only)
//  3. ResolveMemoryDefaults - Require org; mint id; default name from id
//     (memories are id-addressed and usually unnamed); claim the
//     server-owned subject ("" sentinel) and provenance fields
//  4. CheckMemoryEnablement - FAIL-CLOSED org memory_enabled re-check
//     (the attachment's presence is convenience, not authorization)
//  5. CheckMemoryCap - 100-per-subject-per-org ceiling, all states,
//     visible FAILED_PRECONDITION (never silent eviction)
//  6. ResolveSlug - Derive slug from the (possibly defaulted) name
//  7. CheckDuplicate - Org+slug uniqueness
//  8. BuildNewState - Keep the pre-minted id, wipe client status, stamp
//     audit, default private visibility
//  9. InitializeMemoryLifecycle - status.lifecycle_state = proposed +
//     state_changed_at (after BuildNewState so the wipe cannot undo it)
//  10. Persist - Save the memory
//
// No search-index step: memory is not_search_indexed by design (privacy
// — content is subject-only and must not surface in org-visible search).
//
// Note: Unlike Stigmer Cloud, OSS excludes the strict
// first-party-human-operator gate and the caller's own memory_enabled
// check (no per-request user identity — the user scope collapses,
// DD-006 D1) and creates no FGA tuples.
func (c *MemoryController) Create(ctx context.Context, memory *memoryv1.Memory) (*memoryv1.Memory, error) {
	reqCtx := pipeline.NewRequestContext(ctx, memory)

	p := c.buildCreatePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *MemoryController) buildCreatePipeline() *pipeline.Pipeline[*memoryv1.Memory] {
	return pipeline.NewPipeline[*memoryv1.Memory]("memory-create").
		AddStep(steps.NewValidateProtoStep[*memoryv1.Memory]()).
		AddStep(steps.NewValidateVisibilityStep[*memoryv1.Memory]()).
		AddStep(&resolveMemoryDefaultsStep{}).
		AddStep(&checkMemoryEnablementStep{store: c.store}).
		AddStep(&checkMemoryCapStep{store: c.store}).
		AddStep(steps.NewResolveSlugStep[*memoryv1.Memory]()).
		AddStep(steps.NewCheckDuplicateStep[*memoryv1.Memory](c.store)).
		AddStep(steps.NewBuildNewStateStep[*memoryv1.Memory]()).
		AddStep(&initializeMemoryLifecycleStep{}).
		AddStep(steps.NewPersistStep[*memoryv1.Memory](c.store)).
		Build()
}
