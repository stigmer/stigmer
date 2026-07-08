package session

import (
	"context"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// Delete deletes a session by ID using the pipeline pattern.
//
// Deletion cascades to the session's agent executions: they belong to the
// session (spec.session_id) and would otherwise be orphaned. Billing/usage
// data is unaffected — usage records are immutable and carry their own copies
// of session/execution identifiers.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (session ID wrapper)
//  2. ExtractResourceId - Extract ID from SessionId.Value wrapper
//  3. LoadExistingForDelete - Load session from database (stores in context)
//  4. RejectDeleteWithActiveExecutions - FAILED_PRECONDITION while any
//     execution in the session is still active
//  5. CascadeDeleteAgentExecutions - Delete child executions (children before
//     parent, so a mid-failure retry converges)
//  6. DeleteResource - Delete session from database
//  7. DeleteSearchIndex - Remove session from search index
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
// Generic steps (ValidateProto, ExtractResourceId, LoadExistingForDelete,
// DeleteResource, DeleteSearchIndex) are shared across all API resources; the
// active-execution guard and the execution cascade are session-specific and
// mirror the Stigmer Cloud SessionDeleteHandler semantics.
func (c *SessionController) buildDeletePipeline() *pipeline.Pipeline[*sessionv1.SessionId] {
	return pipeline.NewPipeline[*sessionv1.SessionId]("session-delete").
		AddStep(steps.NewValidateProtoStep[*sessionv1.SessionId]()).                                    // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*sessionv1.SessionId]()).                                // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*sessionv1.SessionId, *sessionv1.Session](c.store)). // 3. Load session
		AddStep(newRejectDeleteWithActiveExecutionsStep(c.store)).                                      // 4. Block while executions are active
		AddStep(newCascadeDeleteAgentExecutionsStep(c.store)).                                          // 5. Cascade: children before parent
		AddStep(steps.NewDeleteResourceStep[*sessionv1.SessionId](c.store)).                            // 6. Delete from database
		AddStep(steps.NewDeleteSearchIndexStep[*sessionv1.SessionId](c.store)).                         // 7. Remove from search index
		Build()
}

// isActiveExecutionPhase reports whether an execution phase counts as active
// for the session-delete guard: pending, in progress, waiting for approval,
// or paused. WAITING_FOR_APPROVAL and PAUSED are deliberately included — the
// execution is logically alive and expected to resume. Mirrors the Cloud
// AgentExecutionRepo.countActiveBySessionId phase set.
func isActiveExecutionPhase(phase agentexecutionv1.ExecutionPhase) bool {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED:
		return true
	default:
		return false
	}
}

// listExecutionsBySession loads every agent execution whose spec.session_id
// matches the given session. Shared by the guard and cascade steps.
func listExecutionsBySession(ctx context.Context, s store.Store, sessionID string) ([]*agentexecutionv1.AgentExecution, error) {
	data, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent_execution)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list agent executions")
	}

	var executions []*agentexecutionv1.AgentExecution
	for _, d := range data {
		execution := &agentexecutionv1.AgentExecution{}
		if err := proto.Unmarshal(d, execution); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal execution, skipping")
			continue
		}
		if execution.GetSpec().GetSessionId() == sessionID {
			executions = append(executions, execution)
		}
	}
	return executions, nil
}

// rejectDeleteWithActiveExecutionsStep rejects deletion while any agent
// execution in the session is still active.
//
// Deleting a session mid-run would strand a live execution whose conversation
// no longer exists. The caller must cancel the execution or wait for it to
// finish. Error contract matches Stigmer Cloud's
// SessionDeleteHandler.RejectDeleteWithActiveExecutionsStep.
type rejectDeleteWithActiveExecutionsStep struct {
	store store.Store
}

func newRejectDeleteWithActiveExecutionsStep(s store.Store) *rejectDeleteWithActiveExecutionsStep {
	return &rejectDeleteWithActiveExecutionsStep{store: s}
}

func (s *rejectDeleteWithActiveExecutionsStep) Name() string {
	return "RejectDeleteWithActiveExecutions"
}

func (s *rejectDeleteWithActiveExecutionsStep) Execute(ctx *pipeline.RequestContext[*sessionv1.SessionId]) error {
	sessionID := ctx.Get(steps.ResourceIdKey).(string)

	executions, err := listExecutionsBySession(ctx.Context(), s.store, sessionID)
	if err != nil {
		return err
	}

	activeCount := 0
	for _, execution := range executions {
		if isActiveExecutionPhase(execution.GetStatus().GetPhase()) {
			activeCount++
		}
	}

	if activeCount > 0 {
		return grpclib.FailedPreconditionError(
			"session has %d active execution(s); cancel them or wait for completion before deleting",
			activeCount)
	}

	return nil
}

// cascadeDeleteAgentExecutionsStep deletes the session's agent executions
// before the session row itself is deleted.
//
// Ordering matters for crash safety: children are deleted before the parent,
// so if this step fails partway the session still exists and a retried delete
// converges (already-deleted executions are simply no longer found). The
// reverse order would orphan executions permanently.
//
// Search-index removal per execution is best-effort, matching
// DeleteSearchIndexStep's convention.
type cascadeDeleteAgentExecutionsStep struct {
	store store.Store
}

func newCascadeDeleteAgentExecutionsStep(s store.Store) *cascadeDeleteAgentExecutionsStep {
	return &cascadeDeleteAgentExecutionsStep{store: s}
}

func (s *cascadeDeleteAgentExecutionsStep) Name() string {
	return "CascadeDeleteAgentExecutions"
}

func (s *cascadeDeleteAgentExecutionsStep) Execute(ctx *pipeline.RequestContext[*sessionv1.SessionId]) error {
	sessionID := ctx.Get(steps.ResourceIdKey).(string)

	executions, err := listExecutionsBySession(ctx.Context(), s.store, sessionID)
	if err != nil {
		return err
	}
	if len(executions) == 0 {
		return nil
	}

	for _, execution := range executions {
		executionID := execution.GetMetadata().GetId()
		if err := s.store.DeleteResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution, executionID); err != nil {
			return grpclib.InternalError(err, "failed to cascade-delete execution "+executionID+" of session "+sessionID)
		}
		if err := s.store.DeleteSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution, executionID); err != nil {
			log.Warn().Err(err).
				Str("execution_id", executionID).
				Msg("CascadeDeleteAgentExecutions: failed to remove search index entry (best-effort)")
		}
	}

	log.Info().
		Str("session_id", sessionID).
		Int("count", len(executions)).
		Msg("Cascade-deleted executions of session")

	return nil
}
