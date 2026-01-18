package temporal

import (
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/store/badger"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/activities"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/workflows"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

// WorkerConfig configures and creates Temporal workers for agent execution.
//
// Polyglot Workflow Architecture:
// ================================
// Go Workflow Queue: "agent_execution_stigmer" (stigmer-server owns Go workflows)
// Python Activity Queue: "agent_execution_runner" (agent-runner owns Python activities)
//
// Go Worker (this):
// - Registers: InvokeAgentExecutionWorkflow (orchestration only)
// - Registers: UpdateExecutionStatusActivity (for failure recovery, as LOCAL activity)
// - Does NOT register: ExecuteGraphton, EnsureThread (those are Python activities)
//
// Python Worker (agent-runner):
// - Registers: ExecuteGraphton, EnsureThread, CleanupSandbox (activities only)
// - Does NOT register: workflows (Go handles orchestration)
//
// How Polyglot Works:
// ===================
// 1. Go worker polls "agent_execution_stigmer" for workflow tasks
// 2. Python worker polls "agent_execution_runner" for activity tasks
// 3. Go workflows call activities with explicit task queue routing
// 4. Temporal routes activity tasks to correct worker based on task queue
//
// CRITICAL Rules for Polyglot Success:
// =====================================
// ✅ CORRECT: Each worker registers ONLY what it implements
// ✅ CORRECT: Go = workflows + Go-specific activities
// ✅ CORRECT: Python = Python activities only
// ✅ CORRECT: Activity calls must specify target task queue
//
// ❌ WRONG: Go registers Python activities → Load balancing breaks
// ❌ WRONG: Python registers workflows → Workflow dispatch confusion
// ❌ WRONG: Missing task queue in activity calls → Wrong worker receives task
//
// Why This Works:
// ===============
// Temporal routes tasks based on what each worker advertises:
// - Workflow task for "InvokeAgentExecutionWorkflow" → Goes to Go (only worker that has it)
// - Activity task for "ExecuteGraphton" → Goes to Python (only worker on that queue)
// - Activity task for "UpdateExecutionStatusActivity" → Goes to Go (local activity, in-process)
//
// Environment Variables:
// - TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE (Go workflows, default: agent_execution_stigmer)
// - TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE (Python activities, default: agent_execution_runner)
type WorkerConfig struct {
	config                     *Config
	store                      *badger.Store[*agentexecutionv1.AgentExecution]
	updateStatusActivityImpl   *activities.UpdateExecutionStatusActivityImpl
}

// NewWorkerConfig creates a new WorkerConfig.
func NewWorkerConfig(
	config *Config,
	store *badger.Store[*agentexecutionv1.AgentExecution],
) *WorkerConfig {
	return &WorkerConfig{
		config:                     config,
		store:                      store,
		updateStatusActivityImpl:   activities.NewUpdateExecutionStatusActivityImpl(store),
	}
}

// CreateWorker creates and configures a Temporal worker for agent execution workflows.
//
// Task Queue: "agent_execution_stigmer" (stigmer-server owns Go workflows)
//
// Registered Components:
// - Workflows: InvokeAgentExecutionWorkflow (Go)
// - Activities: UpdateExecutionStatusActivity (Go - for error recovery, LOCAL activity)
//
// NOT Registered (handled by agent-runner on "agent_execution_runner" queue):
// - ExecuteGraphton (Python)
// - EnsureThread (Python)
// - CleanupSandbox (Python)
func (wc *WorkerConfig) CreateWorker(temporalClient client.Client) worker.Worker {
	// Create worker on agent_execution_stigmer queue for Go workflows
	w := worker.New(temporalClient, wc.config.StigmerQueue, worker.Options{})

	// Register Go workflow implementations ONLY
	w.RegisterWorkflow(&workflows.InvokeAgentExecutionWorkflowImpl{})

	log.Info().
		Str("queue", wc.config.StigmerQueue).
		Msg("✅ [POLYGLOT] Registered InvokeAgentExecutionWorkflow (Go)")

	log.Info().
		Str("queue", wc.config.RunnerQueue).
		Msg("✅ [POLYGLOT] Python activities (ExecuteGraphton, EnsureThread, CleanupSandbox) on Python worker")

	// Register local activities (run in-process, don't participate in task queue routing)
	// This avoids need for separate task queue configuration
	w.RegisterActivity(wc.updateStatusActivityImpl.UpdateExecutionStatus)

	log.Info().Msg("✅ [POLYGLOT] Registered UpdateExecutionStatusActivity as LOCAL activity (in-process)")
	log.Info().Msg("✅ [POLYGLOT] Temporal will route: workflow tasks → Go, Python activity tasks → Python")

	return w
}
