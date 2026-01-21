package temporal

import (
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// WorkerConfig configures and creates Temporal workers for workflow execution.
//
// Polyglot Workflow Architecture:
// ================================
// Go Workflow Queue: "workflow_execution_stigmer" (stigmer-server owns Go workflows)
// Go Activity Queue: "workflow_execution_runner" (workflow-runner owns Go activities)
//
// Go Worker (this):
// - Registers: InvokeWorkflowExecutionWorkflow (orchestration only)
// - Registers: UpdateWorkflowExecutionStatusActivity (for failure recovery, as LOCAL activity)
// - Does NOT register: ExecuteWorkflow (that's a Go activity in workflow-runner)
//
// Go Worker (workflow-runner):
// - Registers: ExecuteWorkflow activity (Zigflow execution)
// - Does NOT register: workflows (Go handles orchestration)
//
// How Polyglot Works:
// ===================
// 1. Go worker polls "workflow_execution_stigmer" for workflow tasks
// 2. Go worker (workflow-runner) polls "workflow_execution_runner" for activity tasks
// 3. Go workflows call activities with explicit task queue routing
// 4. Temporal routes activity tasks to correct worker based on task queue
//
// CRITICAL Rules for Polyglot Success:
// =====================================
// ✅ CORRECT: Each worker registers ONLY what it implements
// ✅ CORRECT: stigmer-server = workflows + local activities
// ✅ CORRECT: workflow-runner = workflow execution activities only
// ✅ CORRECT: Activity calls must specify target task queue
//
// ❌ WRONG: stigmer-server registers ExecuteWorkflow → Load balancing breaks
// ❌ WRONG: workflow-runner registers workflows → Workflow dispatch confusion
// ❌ WRONG: Missing task queue in activity calls → Wrong worker receives task
//
// Why This Works:
// ===============
// Temporal routes tasks based on what each worker advertises:
// - Workflow task for "InvokeWorkflowExecutionWorkflow" → Goes to stigmer-server (only worker that has it)
// - Activity task for "ExecuteWorkflow" → Goes to workflow-runner (only worker on that queue)
// - Activity task for "UpdateWorkflowExecutionStatusActivity" → Goes to stigmer-server (local activity, in-process)
//
// Environment Variables:
// - TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE (Go workflows, default: workflow_execution_stigmer)
// - TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE (Go activities, default: workflow_execution_runner)
type WorkerConfig struct {
	config                   *Config
	store                    *badger.Store
	updateStatusActivityImpl *activities.UpdateWorkflowExecutionStatusActivityImpl
}

// NewWorkerConfig creates a new WorkerConfig.
func NewWorkerConfig(
	config *Config,
	store *badger.Store,
	streamBroker activities.StreamBroker,
) *WorkerConfig {
	return &WorkerConfig{
		config:                   config,
		store:                    store,
		updateStatusActivityImpl: activities.NewUpdateWorkflowExecutionStatusActivityImpl(store, streamBroker),
	}
}

// CreateWorker creates and configures a Temporal worker for workflow execution workflows.
//
// Task Queue: "workflow_execution_stigmer" (stigmer-server owns Go workflows)
//
// Registered Components:
// - Workflows: InvokeWorkflowExecutionWorkflow (Go)
// - Activities: UpdateWorkflowExecutionStatusActivity (Go - for error recovery, LOCAL activity)
//
// NOT Registered (handled by workflow-runner on "workflow_execution_runner" queue):
// - ExecuteWorkflow (Go)
func (wc *WorkerConfig) CreateWorker(temporalClient client.Client) worker.Worker {
	// Create worker on workflow_execution_stigmer queue for Go workflows
	w := worker.New(temporalClient, wc.config.StigmerQueue, worker.Options{})

	// Register Go workflow implementations ONLY
	// CRITICAL: Must register with explicit name to match the workflow invocation
	// The workflow is invoked with "stigmer/workflow-execution/invoke" but without explicit
	// registration name, Temporal would use "Run" (the method name), causing "workflow type not found"
	w.RegisterWorkflowWithOptions(
		(&workflows.InvokeWorkflowExecutionWorkflowImpl{}).Run,
		workflow.RegisterOptions{
			Name: workflows.InvokeWorkflowExecutionWorkflowName, // "stigmer/workflow-execution/invoke"
		},
	)

	log.Info().
		Str("queue", wc.config.StigmerQueue).
		Msg("✅ [POLYGLOT] Registered InvokeWorkflowExecutionWorkflow (Go)")

	log.Info().
		Str("queue", wc.config.RunnerQueue).
		Msg("✅ [POLYGLOT] Go activities (ExecuteWorkflow) on workflow-runner worker")

	// Register local activities (run in-process, don't participate in task queue routing)
	// This avoids need for separate task queue configuration
	w.RegisterActivity(wc.updateStatusActivityImpl.UpdateExecutionStatus)

	log.Info().Msg("✅ [POLYGLOT] Registered UpdateWorkflowExecutionStatusActivity as LOCAL activity (in-process)")
	log.Info().Msg("✅ [POLYGLOT] Temporal will route: workflow tasks → stigmer-server, activity tasks → workflow-runner")

	return w
}
