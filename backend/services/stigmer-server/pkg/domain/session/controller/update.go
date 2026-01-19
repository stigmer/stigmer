package session

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
)

// Update updates an existing session using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name (for fallback lookup)
// 3. LoadExisting - Load existing session from repository by ID
// 4. BuildUpdateState - Merge spec, preserve IDs, update timestamps, clear computed fields
// 5. Persist - Save updated session to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *SessionController) Update(ctx context.Context, session *sessionv1.Session) (*sessionv1.Session, error) {
	reqCtx := pipeline.NewRequestContext(ctx, session)
	reqCtx.SetNewState(session)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for session update
func (c *SessionController) buildUpdatePipeline() *pipeline.Pipeline[*sessionv1.Session] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*sessionv1.Session]("session-update").
		AddStep(steps.NewValidateProtoStep[*sessionv1.Session]()).         // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*sessionv1.Session]()).           // 2. Resolve slug (for fallback lookup)
		AddStep(steps.NewLoadExistingStep[*sessionv1.Session](c.store)).   // 3. Load existing session
		AddStep(steps.NewBuildUpdateStateStep[*sessionv1.Session]()).      // 4. Build updated state
		AddStep(steps.NewPersistStep[*sessionv1.Session](c.store)).        // 5. Persist session
		Build()
}
