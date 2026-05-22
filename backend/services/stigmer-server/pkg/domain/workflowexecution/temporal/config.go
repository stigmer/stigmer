package temporal

import (
	"os"
)

// Workflow activity routing mode constants.
const (
	// RoutingGlobal routes all workflow activities/child workflows to the shared
	// global runner queue (stigmer_runner). Default for OSS local development.
	RoutingGlobal = "global"

	// RoutingExecution derives a per-execution task queue (wfexec:{execution_id})
	// when execution_target=CLOUD. The sandbox provisioned for that queue handles
	// the workflow AND all child agent executions.
	RoutingExecution = "execution"
)

// Default execution target constants.
const (
	DefaultExecutionTargetLocal = "local"
	DefaultExecutionTargetCloud = "cloud"
)

// Config holds configuration for workflow execution Temporal workers.
//
// Architecture:
// - stigmer-queue: Go orchestrator workflows (stigmer-server) on workflow_execution_stigmer
// - runner-queue: TS child workflows (unified runner) on stigmer_runner (global) or wfexec:{id} (per-execution)
//
// Environment Variables:
// - TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE: Queue for Go orchestrator workflows
// - TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE: Default queue for TS unified runner (fallback)
// - STIGMER_WORKFLOW_ACTIVITY_ROUTING: Routing mode ("global" or "execution")
// - STIGMER_WORKFLOW_DEFAULT_EXECUTION_TARGET: Default target when spec's is UNSPECIFIED ("local" or "cloud")
type Config struct {
	// StigmerQueue is the task queue for Go orchestrator workflows (stigmer-server).
	// Default: workflow_execution_stigmer
	StigmerQueue string

	// RunnerQueue is the default task queue for the TS unified runner.
	// Default: stigmer_runner
	//
	// In global routing mode, all child workflows route here.
	// In execution routing mode, this serves as the fallback when execution_target != CLOUD.
	RunnerQueue string

	// WorkflowActivityRouting controls how the runner task queue is resolved.
	// "global" (default): all child workflows route to RunnerQueue.
	// "execution": child workflows route to wfexec:{execution_id} when execution_target=CLOUD.
	WorkflowActivityRouting string

	// DefaultExecutionTarget resolves EXECUTION_TARGET_UNSPECIFIED on workflow executions.
	// "local" (default): workflow uses global runner queue.
	// "cloud": server provisions a per-execution sandbox.
	DefaultExecutionTarget string
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() *Config {
	return &Config{
		StigmerQueue:            getEnv("TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE", "workflow_execution_stigmer"),
		RunnerQueue:             getEnv("TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE", "stigmer_runner"),
		WorkflowActivityRouting: getEnv("STIGMER_WORKFLOW_ACTIVITY_ROUTING", RoutingGlobal),
		DefaultExecutionTarget:  getEnv("STIGMER_WORKFLOW_DEFAULT_EXECUTION_TARGET", DefaultExecutionTargetLocal),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
