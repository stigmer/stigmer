package temporal

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
	agentrunnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentrunner/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// DispatchResult holds the resolved Temporal task queue and optional AgentRunner
// ID for routing Python activities. When AgentRunnerID is empty, the global
// shared runner queue was used (backward-compatible path).
type DispatchResult struct {
	TaskQueue     string
	AgentRunnerID string
}

// HasRunner returns true when dispatch resolved to a specific AgentRunner
// (per-runner queue) rather than falling back to the global shared queue.
func (d DispatchResult) HasRunner() bool {
	return d.AgentRunnerID != ""
}

// ResolveActivityTaskQueue determines which Temporal task queue an execution's
// Python activities should be routed to.
//
// Resolution logic:
//  1. If sessionID is empty, return the global fallback queue.
//  2. Load the session; if it has no agent_runner_id, return global fallback.
//  3. Load the AgentRunner by ID.
//  4. Verify the runner is in an active phase (READY or BUSY).
//  5. Return the runner's per-runner task queue from its status.
//
// Error semantics: when a session explicitly references a runner that is in a
// non-active phase (FAILED, STOPPED, PENDING) or does not exist, this function
// returns an error. The user explicitly chose this runner; silently ignoring
// that choice would be surprising.
//
// When the session has no runner binding, or when the session itself is not
// found, the function silently falls back to the global queue.
func ResolveActivityTaskQueue(ctx context.Context, s store.Store, sessionID string, fallbackQueue string) (DispatchResult, error) {
	if sessionID == "" {
		log.Debug().Msg("No session ID provided, using global runner queue")
		return DispatchResult{TaskQueue: fallbackQueue}, nil
	}

	session := &sessionv1.Session{}
	if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_session, sessionID, session); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Warn().Str("session_id", sessionID).
				Msg("Session not found during dispatch resolution, using global runner queue")
			return DispatchResult{TaskQueue: fallbackQueue}, nil
		}
		return DispatchResult{}, fmt.Errorf("failed to load session for dispatch: %w", err)
	}

	agentRunnerID := session.GetSpec().GetAgentRunnerId()
	if agentRunnerID == "" {
		log.Debug().Str("session_id", sessionID).
			Msg("Session has no bound agent runner, using global runner queue")
		return DispatchResult{TaskQueue: fallbackQueue}, nil
	}

	runner := &agentrunnerv1.AgentRunner{}
	if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_runner, agentRunnerID, runner); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return DispatchResult{}, fmt.Errorf(
				"agent runner '%s' not found — it may have been deleted", agentRunnerID)
		}
		return DispatchResult{}, fmt.Errorf("failed to load agent runner for dispatch: %w", err)
	}

	phase := runner.GetStatus().GetPhase()
	if !isActivePhase(phase) {
		return DispatchResult{}, fmt.Errorf(
			"agent runner '%s' is in %s phase and cannot accept work",
			runner.GetMetadata().GetName(), formatPhase(phase))
	}

	taskQueue := runner.GetStatus().GetTaskQueue()
	if taskQueue == "" {
		return DispatchResult{}, fmt.Errorf(
			"agent runner '%s' has no task queue configured", agentRunnerID)
	}

	log.Info().
		Str("session_id", sessionID).
		Str("agent_runner_id", agentRunnerID).
		Str("phase", phase.String()).
		Str("task_queue", taskQueue).
		Msg("Dispatch resolved to per-runner queue")

	return DispatchResult{TaskQueue: taskQueue, AgentRunnerID: agentRunnerID}, nil
}

func isActivePhase(phase agentrunnerv1.AgentRunnerPhase) bool {
	return phase == agentrunnerv1.AgentRunnerPhase_AGENT_RUNNER_PHASE_READY ||
		phase == agentrunnerv1.AgentRunnerPhase_AGENT_RUNNER_PHASE_BUSY
}

func formatPhase(phase agentrunnerv1.AgentRunnerPhase) string {
	switch phase {
	case agentrunnerv1.AgentRunnerPhase_AGENT_RUNNER_PHASE_PENDING:
		return "PENDING"
	case agentrunnerv1.AgentRunnerPhase_AGENT_RUNNER_PHASE_STOPPED:
		return "STOPPED"
	case agentrunnerv1.AgentRunnerPhase_AGENT_RUNNER_PHASE_FAILED:
		return "FAILED"
	default:
		return phase.String()
	}
}
