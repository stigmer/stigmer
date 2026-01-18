package temporal

import (
	"os"
)

// Config holds configuration for agent execution Temporal workers.
//
// Polyglot Architecture:
// - stigmer-queue: Go workflows (stigmer-server) on agent_execution_stigmer
// - runner-queue: Python activities (agent-runner) on agent_execution_runner
//
// Environment Variables:
// - TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE: Queue for Go workflows
// - TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE: Queue for Python activities
type Config struct {
	// StigmerQueue is the task queue for Go workflows (stigmer-server).
	// Default: agent_execution_stigmer
	StigmerQueue string

	// RunnerQueue is the task queue for Python activities (agent-runner).
	// Default: agent_execution_runner
	//
	// This is used by workflow implementations to route activity calls to Python worker.
	RunnerQueue string
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

	return &Config{
		StigmerQueue: stigmerQueue,
		RunnerQueue:  runnerQueue,
	}
}
