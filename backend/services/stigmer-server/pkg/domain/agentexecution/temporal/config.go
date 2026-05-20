package temporal

import (
	"os"
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

// Config holds configuration for agent execution Temporal workers.
//
// Polyglot Architecture:
// - stigmer-queue: Go workflows (stigmer-server) on agent_execution_stigmer
// - runner-queue: Activities on agent_execution_runner (global) or session:{id} (per-session)
//
// Environment Variables:
// - TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE: Queue for Go workflows
// - TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE: Default queue for runner activities
// - STIGMER_ACTIVITY_ROUTING: Routing mode ("global" or "session")
type Config struct {
	// StigmerQueue is the task queue for Go workflows (stigmer-server).
	// Default: agent_execution_stigmer
	StigmerQueue string

	// RunnerQueue is the default task queue for runner activities.
	// Default: agent_execution_runner
	//
	// In global routing mode, all activities route here.
	// In session routing mode, this serves as the fallback when session ID is empty.
	RunnerQueue string

	// ActivityRouting controls how activity task queues are resolved.
	// "global" (default): all activities route to RunnerQueue.
	// "session": activities route to session:{session_id} per-session queues.
	ActivityRouting string
}

// NewConfig creates a new Config with values from environment variables or defaults.
func NewConfig() *Config {
	stigmerQueue := os.Getenv("TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE")
	if stigmerQueue == "" {
		stigmerQueue = "agent_execution_stigmer"
	}

	runnerQueue := os.Getenv("TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE")
	if runnerQueue == "" {
		runnerQueue = "agent_execution_runner"
	}

	activityRouting := os.Getenv("STIGMER_ACTIVITY_ROUTING")
	if activityRouting == "" {
		activityRouting = RoutingGlobal
	}

	return &Config{
		StigmerQueue:    stigmerQueue,
		RunnerQueue:     runnerQueue,
		ActivityRouting: activityRouting,
	}
}
