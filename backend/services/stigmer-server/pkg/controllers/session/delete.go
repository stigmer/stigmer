package session

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	sessionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/session/v1"
)

// Delete deletes a session by ID using the pipeline pattern.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (session ID wrapper)
// 2. ExtractResourceId - Extract ID from SessionId.Value wrapper
// 3. LoadExistingForDelete - Load session from database (stores in context)
// 4. DeleteResource - Delete session from database
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization step (no multi-user auth)
// - IAM policy cleanup (no IAM system)
// - Event publishing (no event system)
//
// The deleted session is returned for audit trail purposes (gRPC convention).
func (c *SessionController) Delete(ctx context.Context, sessionId *sessionv1.SessionId) (*sessionv1.Session, error) {
	// Create request context with the ID wrapper
	reqCtx := pipeline.NewRequestContext(ctx, sessionId)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted session from context (set by LoadExistingForDelete step before deletion)
	deletedSession := reqCtx.Get(steps.ExistingResourceKey)
	if deletedSession == nil {
		return nil, grpclib.InternalError(nil, "deleted session not found in context")
	}

	return deletedSession.(*sessionv1.Session), nil
}

// buildDeletePipeline constructs the pipeline for delete operations
//
// All steps are generic and reusable across all API resources:
// - ValidateProtoStep: Generic proto validation
// - ExtractResourceIdStep: Generic ID extraction from wrapper types
// - LoadExistingForDeleteStep: Generic load by ID
// - DeleteResourceStep: Generic delete by ID
func (c *SessionController) buildDeletePipeline() *pipeline.Pipeline[*sessionv1.SessionId] {
	return pipeline.NewPipeline[*sessionv1.SessionId]("session-delete").
		AddStep(steps.NewValidateProtoStep[*sessionv1.SessionId]()).                                    // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*sessionv1.SessionId]()).                                // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*sessionv1.SessionId, *sessionv1.Session](c.store)). // 3. Load session
		AddStep(steps.NewDeleteResourceStep[*sessionv1.SessionId](c.store)).                            // 4. Delete from database
		Build()
}
