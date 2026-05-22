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
const DefaultActivityTaskQueue = "stigmer_runner"

// sessionTaskQueuePrefix is the prefix for per-session task queue names.
const sessionTaskQueuePrefix = "session:"

// DispatchResult holds the resolved Temporal task queue, session harness,
// and execution target for workflow creation.
type DispatchResult struct {
	TaskQueue       string
	Harness         sessionv1.Harness
	ExecutionTarget sessionv1.ExecutionTarget
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
// When activityTaskQueueOverride is non-empty, it is used directly — this
// enables sandbox sharing where a parent workflow execution passes its own
// queue (wfexec:{id}) so child agents run in the same sandbox without
// provisioning new VMs. ExecutionTarget is set to LOCAL in this case to
// prevent EnsureSessionSandboxStep from triggering.
//
// Routing modes (controlled by Config.ActivityRouting):
//   - "global": Always returns DefaultActivityTaskQueue. All sessions share
//     one runner pool. This is the default for OSS local development.
//   - "session": Returns session:{session_id} when a session ID is available.
//     Each session routes to a dedicated runner. Used by desktop (embedded
//     runners) and cloud (per-session sandboxes).
//
// In both modes, the session is loaded to extract the harness configuration
// (NATIVE vs CURSOR) and the execution target (LOCAL vs CLOUD) which determines
// which activity type the workflow invokes and who provides the runner.
func ResolveActivityTaskQueue(ctx context.Context, s store.Store, sessionID string, cfg *Config, activityTaskQueueOverride string) (DispatchResult, error) {
	// Sandbox affinity: parent workflow already has a sandbox on this queue.
	// Route there directly — no session routing, no sandbox provisioning needed.
	if activityTaskQueueOverride != "" {
		harness := sessionv1.Harness_HARNESS_NATIVE
		if sessionID != "" {
			session := &sessionv1.Session{}
			if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_session, sessionID, session); err == nil {
				harness = session.GetSpec().GetHarness()
			}
		}

		log.Info().
			Str("session_id", sessionID).
			Str("task_queue", activityTaskQueueOverride).
			Str("override_source", "parent_workflow_sandbox").
			Msg("Dispatch using activity_task_queue override (sandbox affinity)")

		return DispatchResult{
			TaskQueue:       activityTaskQueueOverride,
			Harness:         harness,
			ExecutionTarget: sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL,
		}, nil
	}

	harness := sessionv1.Harness_HARNESS_NATIVE
	executionTarget := sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED

	if sessionID != "" {
		session := &sessionv1.Session{}
		if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_session, sessionID, session); err != nil {
			if !errors.Is(err, store.ErrNotFound) {
				return DispatchResult{}, fmt.Errorf("failed to load session for dispatch: %w", err)
			}
			log.Warn().Str("session_id", sessionID).
				Msg("Session not found during dispatch, using defaults")
		} else {
			harness = session.GetSpec().GetHarness()
			executionTarget = session.GetSpec().GetExecutionTarget()
		}
	}

	resolvedTarget := resolveExecutionTarget(executionTarget, cfg)
	taskQueue := resolveTaskQueue(sessionID, cfg)

	log.Info().
		Str("session_id", sessionID).
		Str("task_queue", taskQueue).
		Str("routing_mode", cfg.ActivityRouting).
		Str("execution_target", resolvedTarget.String()).
		Msg("Dispatch resolved activity task queue")

	return DispatchResult{
		TaskQueue:       taskQueue,
		Harness:         harness,
		ExecutionTarget: resolvedTarget,
	}, nil
}

// resolveExecutionTarget resolves UNSPECIFIED to the configured default.
func resolveExecutionTarget(target sessionv1.ExecutionTarget, cfg *Config) sessionv1.ExecutionTarget {
	if target != sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED {
		return target
	}
	if cfg.DefaultExecutionTarget == DefaultExecutionTargetCloud {
		return sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD
	}
	return sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL
}

// resolveTaskQueue derives the task queue name based on routing mode and session ID.
func resolveTaskQueue(sessionID string, cfg *Config) string {
	if cfg.ActivityRouting == RoutingSession && sessionID != "" {
		return FormatSessionTaskQueue(sessionID)
	}
	return cfg.RunnerQueue
}
