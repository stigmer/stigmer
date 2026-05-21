package temporal

import (
	"os"
)

// Config holds configuration for workflow execution Temporal workers.
//
// Architecture:
// - stigmer-queue: Go orchestrator workflows (stigmer-server) on workflow_execution_stigmer
// - runner-queue: TS child workflows (unified runner) on stigmer_runner
//
// Environment Variables:
// - TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE: Queue for Go orchestrator workflows
// - TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE: Queue for TS unified runner child workflows
type Config struct {
	// StigmerQueue is the task queue for Go orchestrator workflows (stigmer-server).
	// Default: workflow_execution_stigmer
	StigmerQueue string

	// RunnerQueue is the task queue for the TS unified runner child workflows.
	// Default: stigmer_runner
	//
	// This is used by workflow implementations to start child workflows on
	// the unified runner.
	RunnerQueue string
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() *Config {
	return &Config{
		StigmerQueue: getEnv("TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE", "workflow_execution_stigmer"),
		RunnerQueue:  getEnv("TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE", "stigmer_runner"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
