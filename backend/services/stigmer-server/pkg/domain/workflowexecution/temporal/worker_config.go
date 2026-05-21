package temporal

import (
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	ecactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/executioncontext/temporal/activities"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// WorkerConfig configures and creates Temporal workers for workflow execution.
//
// Architecture:
// ================================
// Go Orchestrator Queue: "workflow_execution_stigmer" (stigmer-server owns Go workflows)
// TS Runner Queue: "stigmer_runner" (unified runner owns TS child workflows)
//
// Go Worker (this):
// - Registers: InvokeWorkflowExecutionWorkflow (orchestration only)
// - Registers: UpdateWorkflowExecutionStatusActivity (for failure recovery, as LOCAL activity)
// - Registers: DeleteExecutionContextActivity (for EC cleanup, as LOCAL activity)
// - Does NOT register: TS child workflow (that runs in the unified runner)
//
// TS Unified Runner:
// - Registers: "stigmer/workflow/execute-from-execution" workflow
// - Handles actual CNCF Serverless Workflow execution
//
// How It Works:
// ===================
// 1. Go worker polls "workflow_execution_stigmer" for workflow tasks
// 2. Go orchestrator starts a child workflow on the runner queue
// 3. TS unified runner polls "stigmer_runner" for child workflow tasks
// 4. Signal handlers forward pause/resume/relay signals to the child
//
// Environment Variables:
// - TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE (Go workflows, default: workflow_execution_stigmer)
// - TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE (TS child workflows, default: stigmer_runner)
type WorkerConfig struct {
	config                   *Config
	store                    store.Store
	updateStatusActivityImpl *activities.UpdateWorkflowExecutionStatusActivityImpl
	deleteECActivityImpl     *ecactivities.DeleteExecutionContextActivityImpl
}

// NewWorkerConfig creates a new WorkerConfig.
func NewWorkerConfig(
	config *Config,
	store store.Store,
	streamBroker activities.StreamBroker,
) *WorkerConfig {
	return &WorkerConfig{
		config:                   config,
		store:                    store,
		updateStatusActivityImpl: activities.NewUpdateWorkflowExecutionStatusActivityImpl(store, streamBroker),
		deleteECActivityImpl:     ecactivities.NewDeleteExecutionContextActivityImpl(store),
	}
}

// CreateWorker creates and configures a Temporal worker for workflow execution workflows.
//
// Task Queue: "workflow_execution_stigmer" (stigmer-server owns Go orchestrator workflows)
//
// Registered Components:
// - Workflows: InvokeWorkflowExecutionWorkflow (Go orchestrator)
// - Activities: UpdateWorkflowExecutionStatusActivity (Go - for status updates, LOCAL activity)
// - Activities: DeleteExecutionContextActivity (Go - for EC cleanup, LOCAL activity)
//
// NOT Registered (handled by unified TS runner on "stigmer_runner" queue):
// - "stigmer/workflow/execute-from-execution" (TS child workflow)
func (wc *WorkerConfig) CreateWorker(temporalClient client.Client) worker.Worker {
	w := worker.New(temporalClient, wc.config.StigmerQueue, worker.Options{})

	w.RegisterWorkflowWithOptions(
		(&workflows.InvokeWorkflowExecutionWorkflowImpl{}).Run,
		workflow.RegisterOptions{
			Name: workflows.InvokeWorkflowExecutionWorkflowName,
		},
	)

	log.Info().
		Str("queue", wc.config.StigmerQueue).
		Msg("Registered InvokeWorkflowExecutionWorkflow (Go orchestrator)")

	log.Info().
		Str("queue", wc.config.RunnerQueue).
		Msg("TS child workflows (unified runner) on runner queue")

	// Register local activities (run in-process, don't participate in task queue routing)
	w.RegisterActivity(wc.updateStatusActivityImpl.UpdateExecutionStatus)
	w.RegisterActivity(wc.deleteECActivityImpl.DeleteExecutionContext)

	log.Info().Msg("Registered UpdateWorkflowExecutionStatusActivity as LOCAL activity (in-process)")
	log.Info().Msg("Registered DeleteExecutionContextActivity as LOCAL activity (in-process)")

	return w
}
