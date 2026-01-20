package temporal

import (
	"os"
)

// Config holds configuration for workflow validation Temporal workers.
//
// Polyglot Architecture:
// - stigmer-queue: Go workflows (stigmer-server) on workflow_validation_stigmer
// - runner-queue: Go activities (workflow-runner) on workflow_validation_runner
//
// Environment Variables:
// - TEMPORAL_WORKFLOW_VALIDATION_STIGMER_TASK_QUEUE: Queue for Go workflows
// - TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE: Queue for Go activities
type Config struct {
	// StigmerQueue is the task queue for Go workflows (stigmer-server).
	// Default: workflow_validation_stigmer
	StigmerQueue string

	// RunnerQueue is the task queue for Go activities (workflow-runner).
	// Default: workflow_validation_runner
	//
	// This is used by workflow implementations to route activity calls to workflow-runner.
	RunnerQueue string
}

// NewConfig creates a new Config with values from environment variables or defaults.
func NewConfig() *Config {
	stigmerQueue := os.Getenv("TEMPORAL_WORKFLOW_VALIDATION_STIGMER_TASK_QUEUE")
	if stigmerQueue == "" {
		stigmerQueue = "workflow_validation_stigmer"
	}

	runnerQueue := os.Getenv("TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE")
	if runnerQueue == "" {
		runnerQueue = "workflow_validation_runner"
	}

	return &Config{
		StigmerQueue: stigmerQueue,
		RunnerQueue:  runnerQueue,
	}
}
