package temporal

import (
	"os"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
)

// Activity routing mode constants. These control how the dispatch function
// resolves the Temporal task queue for runner activities.
const (
	// RoutingGlobal routes all activities to the shared global queue
	// (agent_execution_runner). This is the default for OSS local development
	// where a single runner polls one queue for all sessions.
	RoutingGlobal = "global"

	// RoutingSession derives a per-session task queue (session:{session_id})
	// for each execution. Use this when each session has a dedicated runner
	// (desktop app with embedded runners, or cloud sandboxes).
	RoutingSession = "session"
)

// Default execution target constants.
const (
	// DefaultExecutionTargetLocal resolves UNSPECIFIED to LOCAL.
	// Used in OSS/self-hosted deployments.
	DefaultExecutionTargetLocal = "local"

	// DefaultExecutionTargetCloud resolves UNSPECIFIED to CLOUD.
	// Used in managed cloud service.
	DefaultExecutionTargetCloud = "cloud"
)

// Config holds configuration for agent execution Temporal workers.
//
// Polyglot Architecture:
// - stigmer-queue: Go workflows (stigmer-server) on agent_execution_stigmer
// - runner-queue: Activities on stigmer_runner (global) or session:{id} (per-session)
//
// Environment Variables:
// - TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE: Queue for Go workflows
// - TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE: Default queue for runner activities
// - STIGMER_ACTIVITY_ROUTING: Routing mode ("global" or "session")
// - STIGMER_DEFAULT_EXECUTION_TARGET: Default target when session's is UNSPECIFIED ("local" or "cloud")
type Config struct {
	// StigmerQueue is the task queue for Go workflows (stigmer-server).
	// Default: agent_execution_stigmer
	StigmerQueue string

	// RunnerQueue is the default task queue for runner activities.
	// Default: stigmer_runner
	//
	// In global routing mode, all activities route here.
	// In session routing mode, this serves as the fallback when session ID is empty.
	RunnerQueue string

	// ActivityRouting controls how activity task queues are resolved.
	// "global" (default): all activities route to RunnerQueue.
	// "session": activities route to session:{session_id} per-session queues.
	ActivityRouting string

	// DefaultExecutionTarget resolves EXECUTION_TARGET_UNSPECIFIED on sessions.
	// "local" (default): client's runner polls the queue.
	// "cloud": server provisions a sandbox.
	DefaultExecutionTarget string
}

// ResolveExecutionTarget resolves a session's execution_target value to its
// effective target: EXECUTION_TARGET_UNSPECIFIED becomes the configured
// DefaultExecutionTarget (LOCAL on OSS/self-hosted, CLOUD on the managed
// cloud service); explicit values pass through unchanged.
//
// This is the single definition of the resolution rule — dispatch
// (ResolveActivityTaskQueue) and policy enforcement (e.g. the session
// update pipeline's execution-target immutability step) must both use it
// rather than re-deriving the default, so they can never disagree about
// where an execution runs. Mirrors the cloud edition's
// AgentExecutionTemporalConfig.resolveExecutionTarget.
func (c *Config) ResolveExecutionTarget(target sessionv1.ExecutionTarget) sessionv1.ExecutionTarget {
	if target != sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED {
		return target
	}
	if c.DefaultExecutionTarget == DefaultExecutionTargetCloud {
		return sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD
	}
	return sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL
}

// NewConfig creates a new Config with values from environment variables or defaults.
func NewConfig() *Config {
	stigmerQueue := os.Getenv("TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE")
	if stigmerQueue == "" {
		stigmerQueue = "agent_execution_stigmer"
	}

	runnerQueue := os.Getenv("TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE")
	if runnerQueue == "" {
		runnerQueue = "stigmer_runner"
	}

	activityRouting := os.Getenv("STIGMER_ACTIVITY_ROUTING")
	if activityRouting == "" {
		activityRouting = RoutingGlobal
	}

	defaultTarget := os.Getenv("STIGMER_DEFAULT_EXECUTION_TARGET")
	if defaultTarget == "" {
		defaultTarget = DefaultExecutionTargetLocal
	}

	return &Config{
		StigmerQueue:           stigmerQueue,
		RunnerQueue:            runnerQueue,
		ActivityRouting:        activityRouting,
		DefaultExecutionTarget: defaultTarget,
	}
}
