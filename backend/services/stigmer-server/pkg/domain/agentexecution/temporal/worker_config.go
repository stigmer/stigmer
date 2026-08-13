package temporal

import (
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows"
	ecactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/executioncontext/temporal/activities"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// WorkerConfig configures and creates Temporal workers for agent execution.
//
// Architecture:
// ================================
// Go Orchestrator Queue: "agent_execution_stigmer" (stigmer-server owns Go workflows)
// TS Runner Queue: "stigmer_runner" (the unified runner owns agent activities;
// session/sandbox routing modes use dynamic "session:{id}" / "wfexec:{id}"
// queues instead — see dispatch.go)
//
// Go Worker (this):
//   - Registers: InvokeAgentExecutionWorkflow (orchestration only)
//   - Registers: CompleteExternalActivity (async activity completion, token handshake)
//   - Registers: UpdateExecutionStatusActivity (named; regular activity for the
//     failure/cancellation paths AND local activity for persistFinalStatus)
//   - Registers (local-only): LoadAgentExecution, DeleteExecutionContext,
//     ReadHarnessStateId
//   - Does NOT register: EnsureThread, ExecuteDeepAgent, ExecuteCursor (those
//     live in the TypeScript unified runner)
//
// TS Unified Runner (backend/services/runner — one worker, both harnesses):
//   - Registers: EnsureThread, ExecuteDeepAgent, ExecuteCursor (plus the
//     workflow-engine activities and its own workflows; see the runner's
//     src/runner.ts activity factory)
//   - Does NOT register: this domain's workflows (Go owns orchestration)
//
// How Routing Works:
// ===================
//  1. Go worker polls "agent_execution_stigmer" for workflow tasks
//  2. The TS runner polls the runner queue for activity tasks
//  3. The workflow reads its activity queue from the workflow MEMO (pinned at
//     creation by workflow_creator.go; resolution rules in dispatch.go)
//  4. Temporal routes each activity task to the worker polling that queue
//
// CRITICAL Rules:
// =====================================
// ✅ CORRECT: Each worker registers ONLY what it implements
// ✅ CORRECT: Go = workflows + Go-side activities
// ✅ CORRECT: TS runner = agent activities only (no workflows of this domain)
// ✅ CORRECT: Activity calls must specify the target task queue
//
// ❌ WRONG: Go registers runner activities → Load balancing breaks
// ❌ WRONG: The runner registers this domain's workflows → dispatch confusion
// ❌ WRONG: Missing task queue in activity calls → Wrong worker receives task
//
// Why This Works:
// ===============
// Each worker polls a dedicated queue, ensuring deterministic routing:
// - Workflow task for "InvokeAgentExecutionWorkflow" → Go (only worker on the stigmer queue)
// - Activity task for "ExecuteDeepAgent" / "ExecuteCursor" / "EnsureThread" → TS runner
// - Activity task for "UpdateExecutionStatusActivity" → Go (registered here, both modes)
//
// Environment Variables:
// - TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE (Go workflows, default: agent_execution_stigmer)
// - TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE (runner activities, default: stigmer_runner)
//
// NOTE: the retired Python agent-runner used to own ExecuteGraphton /
// CleanupSandbox on an "agent_execution_runner" queue. Neither the activities
// nor that queue name exist in live code anymore — the env var NAME above is
// the only surviving wire artifact of that era and must stay byte-identical.
type WorkerConfig struct {
	config                    *Config
	store                     store.Store
	updateStatusActivityImpl  *activities.UpdateExecutionStatusActivityImpl
	loadExecutionActivityImpl *activities.LoadAgentExecutionActivityImpl
	deleteECActivityImpl      *ecactivities.DeleteExecutionContextActivityImpl
	readHarnessStateIdImpl    *activities.ReadHarnessStateIdActivityImpl
}

// NewWorkerConfig creates a new WorkerConfig.
func NewWorkerConfig(
	config *Config,
	store store.Store,
	streamBroker activities.StreamBroker,
) *WorkerConfig {
	return &WorkerConfig{
		config:                    config,
		store:                     store,
		updateStatusActivityImpl:  activities.NewUpdateExecutionStatusActivityImpl(store, streamBroker),
		loadExecutionActivityImpl: activities.NewLoadAgentExecutionActivityImpl(store),
		deleteECActivityImpl:      ecactivities.NewDeleteExecutionContextActivityImpl(store),
		readHarnessStateIdImpl:    activities.NewReadHarnessStateIdActivityImpl(store),
	}
}

// CreateWorker creates and configures a Temporal worker for agent execution workflows.
//
// Task Queue: "agent_execution_stigmer" (stigmer-server owns Go workflows)
//
// Registered Components:
//   - Workflows: InvokeAgentExecutionWorkflow (Go)
//   - Activities: CompleteExternalActivity (Go — async activity completion pattern)
//   - Activities: UpdateExecutionStatusActivity (Go — failure/cancellation recovery,
//     regular activity on the stigmer queue; also invoked as a local activity)
//   - Local-only activities: LoadAgentExecution, DeleteExecutionContext,
//     ReadHarnessStateId (in-process, no task-queue routing)
//
// NOT Registered (handled by the TS unified runner on the runner queue):
// - EnsureThread, ExecuteDeepAgent, ExecuteCursor
func (wc *WorkerConfig) CreateWorker(temporalClient client.Client) worker.Worker {
	// Create worker on agent_execution_stigmer queue for Go workflows
	w := worker.New(temporalClient, wc.config.StigmerQueue, worker.Options{})

	// Register Go workflow implementations ONLY
	// CRITICAL: Must register with explicit name to match the workflow invocation
	// The workflow is invoked with "stigmer/agent-execution/invoke" but without explicit
	// registration name, Temporal would use "Run" (the method name), causing "workflow type not found"
	w.RegisterWorkflowWithOptions(
		(&workflows.InvokeAgentExecutionWorkflowImpl{}).Run,
		workflow.RegisterOptions{
			Name: workflows.InvokeAgentExecutionWorkflowName, // "stigmer/agent-execution/invoke"
		},
	)

	log.Info().
		Str("queue", wc.config.StigmerQueue).
		Msg("✅ [TEMPORAL] Registered InvokeAgentExecutionWorkflow (Go)")

	log.Info().
		Str("queue", wc.config.RunnerQueue).
		Msg("✅ [TEMPORAL] Runner activities (EnsureThread, ExecuteDeepAgent, ExecuteCursor) served by the TS unified runner")

	// Initialize CompleteExternalActivity with Temporal client
	// This enables the async activity completion pattern (token handshake)
	// See: docs/adr/20260122-async-agent-execution-temporal-token-handshake.md
	activities.InitializeCompleteExternalActivity(temporalClient)

	// Register system activity for completing external activities
	// This is a regular activity (not local) because it needs to call Temporal API
	w.RegisterActivityWithOptions(
		activities.CompleteExternalActivity,
		activity.RegisterOptions{
			Name: activities.CompleteExternalActivityName, // "stigmer/system/complete-external-activity"
		},
	)

	log.Info().Msg("✅ [ASYNC-PATTERN] Registered CompleteExternalActivity (for token handshake)")

	// UpdateExecutionStatus: registered as a named activity (regular + local).
	// The failure and cancellation paths invoke it as a regular activity on the
	// stigmer queue to avoid a Temporal SDK replay bug with local-activity markers
	// after remote-activity failures. Defense-in-depth paths (persistFinalStatus)
	// still call it as a local activity -- both modes work with this registration.
	w.RegisterActivityWithOptions(
		wc.updateStatusActivityImpl.UpdateExecutionStatus,
		activity.RegisterOptions{
			Name: activities.UpdateExecutionStatusActivityName,
		},
	)

	// Local-only activities (run in-process, don't participate in task queue routing)
	w.RegisterActivity(wc.loadExecutionActivityImpl.LoadAgentExecution)
	w.RegisterActivity(wc.deleteECActivityImpl.DeleteExecutionContext)
	w.RegisterActivity(wc.readHarnessStateIdImpl.ReadHarnessStateId)

	log.Info().Msg("✅ [TEMPORAL] Registered UpdateExecutionStatusActivity (regular + local, named)")
	log.Info().Msg("✅ [TEMPORAL] Registered LoadAgentExecutionActivity as LOCAL activity (in-process)")
	log.Info().Msg("✅ [TEMPORAL] Registered DeleteExecutionContextActivity as LOCAL activity (in-process)")
	log.Info().Msg("✅ [TEMPORAL] Registered ReadHarnessStateIdActivity as LOCAL activity (Cursor harness harness_state_id)")
	log.Info().Msg("✅ [TEMPORAL] Routing: workflow tasks → Go, agent activity tasks → TS unified runner")

	return w
}
