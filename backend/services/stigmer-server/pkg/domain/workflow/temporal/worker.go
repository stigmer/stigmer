package temporal

import (
	"log"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

// WorkerConfig configures the Temporal worker for workflow validation workflows.
//
// Polyglot Workflow Architecture:
//
//	Go Workflow Queue: "workflow_validation_stigmer" (stigmer-server owns Go workflows)
//	Go Activity Queue: "workflow_validation_runner" (workflow-runner owns Go activities)
//
// Go Worker (this):
// - Registers: ValidateWorkflowWorkflow (orchestration only)
// - Does NOT register: ValidateWorkflow activity (Go activity in workflow-runner)
//
// Go Worker (workflow-runner):
// - Registers: ValidateWorkflow activity
// - Does NOT register: workflows (stigmer-server handles orchestration)
//
// How Polyglot Works:
// 1. Go worker (stigmer-server) polls "workflow_validation_stigmer" for workflow tasks
// 2. Go worker (workflow-runner) polls "workflow_validation_runner" for activity tasks
// 3. Go workflows call activities with explicit task queue routing
// 4. Temporal routes activity tasks to correct worker based on task queue
//
// CRITICAL Rules for Polyglot Success:
// - ✅ CORRECT: Each worker registers ONLY what it implements
// - ✅ CORRECT: stigmer-server = workflows only
// - ✅ CORRECT: workflow-runner = activities only
// - ✅ CORRECT: Activity calls must specify target task queue
// - ❌ WRONG: stigmer-server registers Go activities → Load balancing breaks
// - ❌ WRONG: workflow-runner registers workflows → Workflow dispatch confusion
//
// Environment Variables:
// - TEMPORAL_WORKFLOW_VALIDATION_STIGMER_TASK_QUEUE (Go workflows, default: workflow_validation_stigmer)
// - TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE (Go activities, default: workflow_validation_runner)
type WorkerConfig struct {
	config *Config
}

// NewWorkerConfig creates a new WorkerConfig.
func NewWorkerConfig(config *Config) *WorkerConfig {
	return &WorkerConfig{
		config: config,
	}
}

// CreateWorker creates and configures a Temporal worker for workflow validation workflows.
//
// Task Queue: "workflow_validation_stigmer" (stigmer-server owns Go workflows)
//
// Registered Components:
// - Workflows: ValidateWorkflowWorkflow (Go)
//
// NOT Registered (handled by workflow-runner on "workflow_validation_runner" queue):
// - ValidateWorkflow activity (Go)
func (wc *WorkerConfig) CreateWorker(temporalClient client.Client) worker.Worker {
	// Create worker on workflow_validation_stigmer queue for Go workflows
	w := worker.New(temporalClient, wc.config.StigmerQueue, worker.Options{})

	// Register Go workflow implementations ONLY
	w.RegisterWorkflow(ValidateWorkflowWorkflowImpl)

	log.Printf("✅ [POLYGLOT] Registered ValidateWorkflowWorkflow (Go) on '%s' task queue (type: %s)", wc.config.StigmerQueue, WorkflowValidationWorkflowType)
	log.Printf("✅ [POLYGLOT] Go activities (ValidateWorkflow) on '%s' queue", wc.config.RunnerQueue)
	log.Printf("✅ [POLYGLOT] Temporal will route: workflow tasks → stigmer-server, Go activity tasks → workflow-runner")

	return w
}
