package harness

import (
	"context"
	"fmt"
	"log/slog"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stretchr/testify/assert"
)

// AgentExecutionWaiter polls agent execution status until a condition is met.
type AgentExecutionWaiter struct {
	client agentexecv1.AgentExecutionQueryControllerClient
	logger *slog.Logger
}

// NewAgentExecutionWaiter creates a waiter using the given query client.
func NewAgentExecutionWaiter(client agentexecv1.AgentExecutionQueryControllerClient, logger *slog.Logger) *AgentExecutionWaiter {
	if logger == nil {
		logger = slog.Default()
	}
	return &AgentExecutionWaiter{client: client, logger: logger}
}

// WaitForPhase polls until the agent execution reaches the specified phase or times out.
func (w *AgentExecutionWaiter) WaitForPhase(ctx context.Context, executionID string, target agentexecv1.ExecutionPhase, timeout time.Duration) (*agentexecv1.AgentExecution, error) {
	if timeout == 0 {
		timeout = defaultTimeout
	}

	deadline := time.Now().Add(timeout)
	interval := defaultPollInterval

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		exec, err := w.client.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
		if err != nil {
			w.logger.Debug("agent execution poll error (will retry)", "execution_id", executionID, "error", err)
			time.Sleep(interval)
			interval = nextInterval(interval)
			continue
		}

		currentPhase := exec.GetStatus().GetPhase()
		if currentPhase == target {
			return exec, nil
		}

		if isAgentTerminalPhase(currentPhase) && currentPhase != target {
			return exec, fmt.Errorf("agent execution reached terminal phase %s instead of expected %s",
				currentPhase.String(), target.String())
		}

		w.logger.Debug("agent execution still running",
			"execution_id", executionID,
			"phase", currentPhase.String(),
			"messages", len(exec.GetStatus().GetMessages()),
		)

		time.Sleep(interval)
		interval = nextInterval(interval)
	}

	return nil, fmt.Errorf("timed out waiting for agent execution %s to reach phase %s after %v",
		executionID, target.String(), timeout)
}

// WaitForApproval polls until the agent execution reaches WAITING_FOR_APPROVAL.
func (w *AgentExecutionWaiter) WaitForApproval(ctx context.Context, executionID string, timeout time.Duration) (*agentexecv1.AgentExecution, error) {
	return w.WaitForPhase(ctx, executionID, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, timeout)
}

// WaitForTerminal polls until the agent execution reaches any terminal phase.
func (w *AgentExecutionWaiter) WaitForTerminal(ctx context.Context, executionID string, timeout time.Duration) (*agentexecv1.AgentExecution, error) {
	if timeout == 0 {
		timeout = defaultTimeout
	}

	deadline := time.Now().Add(timeout)
	interval := defaultPollInterval

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		exec, err := w.client.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
		if err != nil {
			w.logger.Debug("agent execution poll error (will retry)", "execution_id", executionID, "error", err)
			time.Sleep(interval)
			interval = nextInterval(interval)
			continue
		}

		if isAgentTerminalPhase(exec.GetStatus().GetPhase()) {
			return exec, nil
		}

		time.Sleep(interval)
		interval = nextInterval(interval)
	}

	return nil, fmt.Errorf("timed out waiting for agent execution %s to reach terminal phase after %v",
		executionID, timeout)
}

func isAgentTerminalPhase(phase agentexecv1.ExecutionPhase) bool {
	switch phase {
	case agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		agentexecv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecv1.ExecutionPhase_EXECUTION_CANCELLED,
		agentexecv1.ExecutionPhase_EXECUTION_TERMINATED:
		return true
	default:
		return false
	}
}

// --- Assertion helpers for agent executions ---

// AssertAgentPhase asserts the agent execution is in the expected phase.
func AssertAgentPhase(t *testing.T, exec *agentexecv1.AgentExecution, expected agentexecv1.ExecutionPhase) {
	t.Helper()
	assert.Equal(t, expected, exec.GetStatus().GetPhase(),
		"expected agent execution phase %s, got %s", expected.String(), exec.GetStatus().GetPhase().String())
}

// AssertMessages verifies that the execution's messages contain the expected
// message types in order. Extra messages between expected types are allowed.
func AssertMessages(t *testing.T, exec *agentexecv1.AgentExecution, expectedTypes ...agentexecv1.MessageType) {
	t.Helper()
	messages := exec.GetStatus().GetMessages()
	typeIdx := 0
	for _, msg := range messages {
		if typeIdx >= len(expectedTypes) {
			break
		}
		if msg.GetType() == expectedTypes[typeIdx] {
			typeIdx++
		}
	}
	assert.Equalf(t, len(expectedTypes), typeIdx,
		"expected message types %v in order; found %d of %d in %d messages",
		expectedTypes, typeIdx, len(expectedTypes), len(messages))
}

// AssertHasToolCall verifies that at least one tool call with the given name
// exists in the execution's messages.
func AssertHasToolCall(t *testing.T, exec *agentexecv1.AgentExecution, toolName string) {
	t.Helper()
	for _, msg := range exec.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetName() == toolName {
				return
			}
		}
	}
	t.Errorf("expected tool call %q not found in execution messages", toolName)
}

// AssertToolCallMcpSlug verifies that a tool call with the given name has the
// expected mcp_server_slug.
func AssertToolCallMcpSlug(t *testing.T, exec *agentexecv1.AgentExecution, toolName, expectedSlug string) {
	t.Helper()
	for _, msg := range exec.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetName() == toolName {
				assert.Equal(t, expectedSlug, tc.GetMcpServerSlug(),
					"tool call %q: expected mcp_server_slug %q, got %q", toolName, expectedSlug, tc.GetMcpServerSlug())
				return
			}
		}
	}
	t.Errorf("tool call %q not found in execution messages", toolName)
}

// AssertSubAgents verifies that the execution has sub-agent executions with
// the given names.
func AssertSubAgents(t *testing.T, exec *agentexecv1.AgentExecution, expectedNames ...string) {
	t.Helper()
	subAgents := exec.GetStatus().GetSubAgentExecutions()
	found := make(map[string]bool)
	for _, sa := range subAgents {
		found[sa.GetName()] = true
	}
	for _, name := range expectedNames {
		assert.Truef(t, found[name], "expected sub-agent %q not found in execution", name)
	}
}

// AssertPendingApprovals verifies the number of pending approvals.
func AssertPendingApprovals(t *testing.T, exec *agentexecv1.AgentExecution, expectedCount int) {
	t.Helper()
	actual := len(exec.GetStatus().GetPendingApprovals())
	assert.Equal(t, expectedCount, actual,
		"expected %d pending approvals, got %d", expectedCount, actual)
}
