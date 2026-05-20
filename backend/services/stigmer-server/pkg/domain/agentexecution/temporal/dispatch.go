package temporal

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// DefaultActivityTaskQueue is the fallback Temporal task queue for activity
// routing. This will be replaced by per-session task queue routing in T04.
const DefaultActivityTaskQueue = "agent_execution_runner"

// DispatchResult holds the resolved Temporal task queue and session harness
// for workflow creation.
type DispatchResult struct {
	TaskQueue string
	Harness   sessionv1.Harness
}

// ResolveActivityTaskQueue determines which Temporal task queue an execution's
// activities should be routed to.
//
// Current (simplified): Returns the default global queue. The session is loaded
// only to extract the harness configuration. Per-session routing will replace
// this in T04.
func ResolveActivityTaskQueue(ctx context.Context, s store.Store, sessionID string) (DispatchResult, error) {
	harness := sessionv1.Harness_HARNESS_NATIVE

	if sessionID != "" {
		session := &sessionv1.Session{}
		if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_session, sessionID, session); err != nil {
			if !errors.Is(err, store.ErrNotFound) {
				return DispatchResult{}, fmt.Errorf("failed to load session for dispatch: %w", err)
			}
			log.Warn().Str("session_id", sessionID).
				Msg("Session not found during dispatch, using default queue")
		} else {
			harness = session.GetSpec().GetHarness()
		}
	}

	log.Info().
		Str("session_id", sessionID).
		Str("task_queue", DefaultActivityTaskQueue).
		Msg("Dispatch resolved to default activity queue")

	return DispatchResult{
		TaskQueue: DefaultActivityTaskQueue,
		Harness:   harness,
	}, nil
}
