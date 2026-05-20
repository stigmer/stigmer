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
// routing. Used in global routing mode and as a fallback when session ID is
// empty in per-session mode.
const DefaultActivityTaskQueue = "agent_execution_runner"

// sessionTaskQueuePrefix is the prefix for per-session task queue names.
const sessionTaskQueuePrefix = "session:"

// DispatchResult holds the resolved Temporal task queue and session harness
// for workflow creation.
type DispatchResult struct {
	TaskQueue string
	Harness   sessionv1.Harness
}

// FormatSessionTaskQueue derives the canonical Temporal task queue name for a
// given session ID. The format is "session:{session_id}".
//
// This is a pure function with no side effects — it can be used by any
// component that needs to derive or validate a session task queue name
// (e.g., runner boot scripts, integration tests, cloud sandbox provisioning).
func FormatSessionTaskQueue(sessionID string) string {
	return sessionTaskQueuePrefix + sessionID
}

// ResolveActivityTaskQueue determines which Temporal task queue an execution's
// activities should be routed to.
//
// Routing modes (controlled by Config.ActivityRouting):
//   - "global": Always returns DefaultActivityTaskQueue. All sessions share
//     one runner pool. This is the default for OSS local development.
//   - "session": Returns session:{session_id} when a session ID is available.
//     Each session routes to a dedicated runner. Used by desktop (embedded
//     runners) and cloud (per-session sandboxes).
//
// In both modes, the session is loaded to extract the harness configuration
// (NATIVE vs CURSOR) which determines which activity type the workflow invokes.
func ResolveActivityTaskQueue(ctx context.Context, s store.Store, sessionID string, cfg *Config) (DispatchResult, error) {
	harness := sessionv1.Harness_HARNESS_NATIVE

	if sessionID != "" {
		session := &sessionv1.Session{}
		if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_session, sessionID, session); err != nil {
			if !errors.Is(err, store.ErrNotFound) {
				return DispatchResult{}, fmt.Errorf("failed to load session for dispatch: %w", err)
			}
			log.Warn().Str("session_id", sessionID).
				Msg("Session not found during dispatch, using default harness")
		} else {
			harness = session.GetSpec().GetHarness()
		}
	}

	taskQueue := resolveTaskQueue(sessionID, cfg)

	log.Info().
		Str("session_id", sessionID).
		Str("task_queue", taskQueue).
		Str("routing_mode", cfg.ActivityRouting).
		Msg("Dispatch resolved activity task queue")

	return DispatchResult{
		TaskQueue: taskQueue,
		Harness:   harness,
	}, nil
}

// resolveTaskQueue derives the task queue name based on routing mode and session ID.
func resolveTaskQueue(sessionID string, cfg *Config) string {
	if cfg.ActivityRouting == RoutingSession && sessionID != "" {
		return FormatSessionTaskQueue(sessionID)
	}
	return cfg.RunnerQueue
}
