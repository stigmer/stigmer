package temporal

import (
	"github.com/rs/zerolog/log"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
)

// WfExecQueuePrefix is the prefix for per-execution task queue names.
// Format: "wfexec:{workflow_execution_id}"
const WfExecQueuePrefix = "wfexec:"

// WorkflowDispatchResult holds the resolved Temporal task queue and execution
// target for the workflow execution's child workflow dispatch.
type WorkflowDispatchResult struct {
	TaskQueue       string
	ExecutionTarget sessionv1.ExecutionTarget
}

// FormatWfExecTaskQueue derives the canonical Temporal task queue name for a
// given workflow execution ID. Format: "wfexec:{execution_id}".
func FormatWfExecTaskQueue(executionID string) string {
	return WfExecQueuePrefix + executionID
}

// ResolveWorkflowTaskQueue determines which Temporal task queue a workflow
// execution's child workflow should be started on.
//
// Routing modes (controlled by Config.WorkflowActivityRouting):
//   - "global": Always returns Config.RunnerQueue (stigmer_runner). All workflow
//     executions share the global runner pool. Default for OSS.
//   - "execution": Returns wfexec:{execution_id} when execution_target resolves
//     to CLOUD. A dedicated sandbox is provisioned for that queue. Used by
//     managed cloud service for sandbox sharing between workflow and child agents.
func ResolveWorkflowTaskQueue(executionID string, executionTarget sessionv1.ExecutionTarget, cfg *Config) WorkflowDispatchResult {
	resolved := resolveWorkflowExecutionTarget(executionTarget, cfg)

	if cfg.WorkflowActivityRouting == RoutingExecution && resolved == sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD {
		taskQueue := FormatWfExecTaskQueue(executionID)

		log.Info().
			Str("execution_id", executionID).
			Str("task_queue", taskQueue).
			Str("routing_mode", cfg.WorkflowActivityRouting).
			Str("execution_target", resolved.String()).
			Msg("Workflow dispatch resolved per-execution queue")

		return WorkflowDispatchResult{
			TaskQueue:       taskQueue,
			ExecutionTarget: resolved,
		}
	}

	log.Info().
		Str("execution_id", executionID).
		Str("task_queue", cfg.RunnerQueue).
		Str("routing_mode", cfg.WorkflowActivityRouting).
		Str("execution_target", resolved.String()).
		Msg("Workflow dispatch resolved global queue")

	return WorkflowDispatchResult{
		TaskQueue:       cfg.RunnerQueue,
		ExecutionTarget: resolved,
	}
}

// resolveWorkflowExecutionTarget resolves UNSPECIFIED to the configured default.
func resolveWorkflowExecutionTarget(target sessionv1.ExecutionTarget, cfg *Config) sessionv1.ExecutionTarget {
	if target != sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED {
		return target
	}
	if cfg.DefaultExecutionTarget == DefaultExecutionTargetCloud {
		return sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD
	}
	return sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL
}
