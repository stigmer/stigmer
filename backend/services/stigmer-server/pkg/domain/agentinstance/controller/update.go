package agentinstance

import (
	"context"

	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Update updates an existing agent instance using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. LoadExisting - Load existing agent instance from repository by ID
// 4. ValidateInstanceUpdate - spec.agent_id is immutable
// 5. BuildUpdateState - Merge spec, preserve IDs, update timestamps, clear computed fields
// 6. Persist - Save updated agent instance to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *AgentInstanceController) Update(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, instance)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for agent instance update
func (c *AgentInstanceController) buildUpdatePipeline() *pipeline.Pipeline[*agentinstancev1.AgentInstance] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*agentinstancev1.AgentInstance]("agent-instance-update").
		AddStep(steps.NewValidateProtoStep[*agentinstancev1.AgentInstance]()).                                           // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*agentinstancev1.AgentInstance]()).                                             // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*agentinstancev1.AgentInstance](c.store)).                                     // 3. Load existing instance
		AddStep(&validateInstanceUpdateStep{}).                                                                          // 4. spec.agent_id is immutable
		AddStep(steps.NewBuildUpdateStateStep[*agentinstancev1.AgentInstance]()).                                        // 5. Build updated state
		AddStep(steps.NewNormalizeReferencesStep[*agentinstancev1.AgentInstance]()).                                     // 6. Normalize cross-references
		AddStep(steps.NewPersistStep[*agentinstancev1.AgentInstance](c.store)).                                          // 7. Persist instance
		AddStep(steps.NewIndexSearchStep[*agentinstancev1.AgentInstance](c.store, &extractor.AgentInstanceExtractor{})). // 8. Update search index
		Build()
}

// validateInstanceUpdateStep enforces the instance's immutable identity on
// update: spec.agent_id must keep referencing the same agent. An instance is
// a configured materialization OF one agent — repointing it would silently
// change what its executions run while keeping the instance's identity,
// history, and references intact; create a new instance instead (oss#646).
//
// Rejecting (rather than silently preserving, as BuildUpdateState does for
// metadata.visibility) is deliberate: visibility has a legitimate second
// door — the guarded updateVisibility RPC — so stale manifests carrying an
// old level are routine and must not fail the update. The parent ref has NO
// other door; no manifest with a different agent_id was ever valid, so a
// differing value is always a client error and deserves a loud failure.
// Same posture as the AgentChannel and Schedule update guards, and as the
// cloud edition's twin step.
//
// Runs after LoadExisting so the existing state is available. Apply
// delegates to Update for existing resources, so this guard covers the
// apply door too. An EMPTY request agent_id never reaches this step —
// buf validate pins min_len=1, so ValidateProto rejects it first.
type validateInstanceUpdateStep struct{}

func (s *validateInstanceUpdateStep) Name() string {
	return "ValidateInstanceUpdate"
}

func (s *validateInstanceUpdateStep) Execute(ctx *pipeline.RequestContext[*agentinstancev1.AgentInstance]) error {
	existingVal := ctx.Get(steps.ExistingResourceKey)
	if existingVal == nil {
		return grpclib.InternalError(nil, "existing agent instance not found in context")
	}
	existing := existingVal.(*agentinstancev1.AgentInstance)

	if ctx.Input().GetSpec().GetAgentId() != existing.GetSpec().GetAgentId() {
		return grpclib.FailedPreconditionError(
			"spec.agent_id is immutable (instance instantiates agent %s) — create a new instance for a different agent",
			existing.GetSpec().GetAgentId(),
		)
	}

	return nil
}
