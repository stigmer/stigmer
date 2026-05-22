package temporal

import (
	"testing"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
)

func TestResolveWorkflowTaskQueue(t *testing.T) {
	globalCfg := &Config{
		RunnerQueue:             "stigmer_runner",
		WorkflowActivityRouting: RoutingGlobal,
		DefaultExecutionTarget:  DefaultExecutionTargetLocal,
	}

	executionCfg := &Config{
		RunnerQueue:             "stigmer_runner",
		WorkflowActivityRouting: RoutingExecution,
		DefaultExecutionTarget:  DefaultExecutionTargetCloud,
	}

	t.Run("global routing always returns runner queue", func(t *testing.T) {
		result := ResolveWorkflowTaskQueue("wfx_test_123", sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD, globalCfg)
		if result.TaskQueue != "stigmer_runner" {
			t.Errorf("expected stigmer_runner, got %q", result.TaskQueue)
		}
	})

	t.Run("global routing ignores execution_target", func(t *testing.T) {
		result := ResolveWorkflowTaskQueue("wfx_test_456", sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED, globalCfg)
		if result.TaskQueue != "stigmer_runner" {
			t.Errorf("expected stigmer_runner, got %q", result.TaskQueue)
		}
	})

	t.Run("execution routing with CLOUD returns wfexec queue", func(t *testing.T) {
		result := ResolveWorkflowTaskQueue("wfx_cloud_789", sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD, executionCfg)
		expected := "wfexec:wfx_cloud_789"
		if result.TaskQueue != expected {
			t.Errorf("expected %q, got %q", expected, result.TaskQueue)
		}
		if result.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD {
			t.Errorf("expected CLOUD, got %v", result.ExecutionTarget)
		}
	})

	t.Run("execution routing with UNSPECIFIED resolves to CLOUD via config", func(t *testing.T) {
		result := ResolveWorkflowTaskQueue("wfx_unspec_aaa", sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED, executionCfg)
		expected := "wfexec:wfx_unspec_aaa"
		if result.TaskQueue != expected {
			t.Errorf("expected %q, got %q", expected, result.TaskQueue)
		}
		if result.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD {
			t.Errorf("expected CLOUD (from config default), got %v", result.ExecutionTarget)
		}
	})

	t.Run("execution routing with LOCAL returns global queue", func(t *testing.T) {
		result := ResolveWorkflowTaskQueue("wfx_local_bbb", sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL, executionCfg)
		if result.TaskQueue != "stigmer_runner" {
			t.Errorf("expected stigmer_runner for LOCAL target, got %q", result.TaskQueue)
		}
		if result.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL {
			t.Errorf("expected LOCAL, got %v", result.ExecutionTarget)
		}
	})

	t.Run("FormatWfExecTaskQueue produces correct format", func(t *testing.T) {
		queue := FormatWfExecTaskQueue("wfx_abc123")
		expected := "wfexec:wfx_abc123"
		if queue != expected {
			t.Errorf("expected %q, got %q", expected, queue)
		}
	})
}
