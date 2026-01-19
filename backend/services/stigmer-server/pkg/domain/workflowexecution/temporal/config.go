package temporal

import (
	"os"
)

// Config holds configuration for workflow execution Temporal workers.
//
// Polyglot Architecture:
// - stigmer-queue: Go workflows (stigmer-server) on workflow_execution_stigmer
// - runner-queue: Go activities (workflow-runner) on workflow_execution_runner
//
// Environment Variables:
// - TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE: Queue for Go workflows
// - TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE: Queue for Go activities
type Config struct {
	// StigmerQueue is the task queue for Go workflows (stigmer-server).
	// Default: workflow_execution_stigmer
	StigmerQueue string

	// RunnerQueue is the task queue for Go activities (workflow-runner).
	// Default: workflow_execution_runner
	//
	// This is used by workflow implementations to route activity calls to Go worker.
	RunnerQueue string
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() *Config {
	return &Config{
		StigmerQueue: getEnv("TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE", "workflow_execution_stigmer"),
		RunnerQueue:  getEnv("TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE", "workflow_execution_runner"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
