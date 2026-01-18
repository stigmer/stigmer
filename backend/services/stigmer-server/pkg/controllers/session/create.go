package session

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	sessionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/session/v1"
)

// Create creates a new session using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event)
// 4. Persist - Save session to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - PublishToRedis step (no Redis in OSS)
func (c *SessionController) Create(ctx context.Context, session *sessionv1.Session) (*sessionv1.Session, error) {
	reqCtx := pipeline.NewRequestContext(ctx, session)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for session creation
func (c *SessionController) buildCreatePipeline() *pipeline.Pipeline[*sessionv1.Session] {
	return pipeline.NewPipeline[*sessionv1.Session]("session-create").
		AddStep(steps.NewValidateProtoStep[*sessionv1.Session]()).  // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*sessionv1.Session]()).    // 2. Resolve slug
		AddStep(steps.NewBuildNewStateStep[*sessionv1.Session]()).  // 3. Build new state
		AddStep(steps.NewPersistStep[*sessionv1.Session](c.store)). // 4. Persist session
		Build()
}
