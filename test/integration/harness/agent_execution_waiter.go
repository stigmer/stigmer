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
		exec, err := w.client.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
		if err != nil {
			w.logger.Debug("agent execution poll error (will retry)", "execution_id", executionID, "error", err)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(interval):
			}
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

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}
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
		exec, err := w.client.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
		if err != nil {
			w.logger.Debug("agent execution poll error (will retry)", "execution_id", executionID, "error", err)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(interval):
			}
			interval = nextInterval(interval)
			continue
		}

		if isAgentTerminalPhase(exec.GetStatus().GetPhase()) {
			return exec, nil
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}
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

// ResolveApprovalsUntilPhase submits approval actions for all pending approvals
// whenever the execution is WAITING_FOR_APPROVAL, until it reaches the target
// phase or times out. The LLM may request the same tool again after resume,
// which surfaces additional approval rounds.
func (w *AgentExecutionWaiter) ResolveApprovalsUntilPhase(
	ctx context.Context,
	clients *Clients,
	executionID string,
	action agentexecv1.ApprovalAction,
	target agentexecv1.ExecutionPhase,
	timeout time.Duration,
) (*agentexecv1.AgentExecution, error) {
	deadline := time.Now().Add(timeout)
	interval := 500 * time.Millisecond

	for time.Now().Before(deadline) {
		exec, err := w.client.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
		if err != nil {
			return nil, fmt.Errorf("get execution %s: %w", executionID, err)
		}

		phase := exec.GetStatus().GetPhase()
		if phase == target {
			return exec, nil
		}

		if phase == agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
			for _, approval := range exec.GetStatus().GetPendingApprovals() {
				_, err := clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
					AgentExecutionId: executionID,
					ToolCallId:       approval.GetToolCallId(),
					Action:           action,
				})
				if err != nil {
					return nil, fmt.Errorf("submit approval for %s: %w", approval.GetToolCallId(), err)
				}
			}
		}

		if isAgentTerminalPhase(phase) && phase != target {
			return exec, fmt.Errorf(
				"agent execution reached terminal phase %s instead of expected %s",
				phase.String(), target.String(),
			)
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}
	}

	return nil, fmt.Errorf(
		"timed out waiting for agent execution %s to reach phase %s after %v",
		executionID, target.String(), timeout,
	)
}

// WaitForApprovalWithRetry creates an execution, waits for approval, and
// retries once with a fresh execution if the LLM skips the tool call
// (execution reaches COMPLETED instead of WAITING_FOR_APPROVAL). This
// handles inherent LLM non-determinism in HITL tests without masking
// infrastructure bugs: only COMPLETED (LLM text response) triggers a retry;
// FAILED or TERMINATED still fail immediately.
func (w *AgentExecutionWaiter) WaitForApprovalWithRetry(
	t *testing.T,
	ctx context.Context,
	clients *Clients,
	sessionID string,
	message string,
	timeout time.Duration,
	opts ...AgentExecutionOption,
) (*agentexecv1.AgentExecution, *agentexecv1.AgentExecution) {
	t.Helper()
	const maxAttempts = 2

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		exec := CreateTestAgentExecution(t, ctx, clients, sessionID, message, opts...)

		result, err := w.WaitForApproval(ctx, exec.GetMetadata().GetId(), timeout)
		if err == nil {
			return exec, result
		}

		// Only retry when the LLM responded with text instead of calling the
		// tool (execution completed normally). Any other terminal phase is a
		// real failure, not LLM non-determinism.
		if result != nil && result.GetStatus().GetPhase() == agentexecv1.ExecutionPhase_EXECUTION_COMPLETED && attempt < maxAttempts {
			t.Logf("HITL retry: LLM skipped tool call on attempt %d (phase=COMPLETED), retrying with fresh execution", attempt)
			LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
			continue
		}

		LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
		t.Fatalf("execution did not reach WAITING_FOR_APPROVAL after %d attempt(s): %v", attempt, err)
	}

	// unreachable, but satisfies the compiler
	return nil, nil
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

// HasToolCall returns true if at least one tool call with the given name
// exists in the execution's messages.
func HasToolCall(exec *agentexecv1.AgentExecution, toolName string) bool {
	for _, msg := range exec.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetName() == toolName {
				return true
			}
		}
	}
	return false
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

// FindSubAgent returns the first SubAgentExecution with the given name,
// or nil if not found.
func FindSubAgent(exec *agentexecv1.AgentExecution, name string) *agentexecv1.SubAgentExecution {
	for _, sa := range exec.GetStatus().GetSubAgentExecutions() {
		if sa.GetName() == name {
			return sa
		}
	}
	return nil
}

// FindFirstSubAgent returns the first SubAgentExecution, or nil if none exist.
// Use when the sub-agent name is non-deterministic (e.g., Cursor harness where
// the name is derived from the LLM's Task tool description, not the blueprint name).
func FindFirstSubAgent(exec *agentexecv1.AgentExecution) *agentexecv1.SubAgentExecution {
	sas := exec.GetStatus().GetSubAgentExecutions()
	if len(sas) == 0 {
		return nil
	}
	return sas[0]
}

// HasSubAgentDelegation returns true if at least one SubAgentExecution
// is present on the execution status.
func HasSubAgentDelegation(exec *agentexecv1.AgentExecution) bool {
	return len(exec.GetStatus().GetSubAgentExecutions()) > 0
}

// AssertSubAgentExecution validates the full SubAgentExecution proto field
// contract. Asserts structural fields that the runner must populate for every
// sub-agent invocation: id, name, subject, timestamps, and status-dependent
// output/error. Mirrors the ToolCall contract pattern from agent_execution_13.
func AssertSubAgentExecution(t *testing.T, sa *agentexecv1.SubAgentExecution) {
	t.Helper()

	assert.NotEmpty(t, sa.GetId(),
		"SubAgentExecution.id must be non-empty (tool call correlation key)")

	assert.NotEmpty(t, sa.GetName(),
		"SubAgentExecution.name must be non-empty (sub-agent type)")

	assert.NotEmpty(t, sa.GetSubject(),
		"SubAgentExecution.subject must be non-empty (display label from task tool description)")

	assert.NotEmpty(t, sa.GetStartedAt(),
		"SubAgentExecution.started_at must be non-empty (ISO 8601 timestamp)")

	status := sa.GetStatus()
	switch status {
	case agentexecv1.SubAgentStatus_SUB_AGENT_COMPLETED:
		assert.NotEmpty(t, sa.GetCompletedAt(),
			"SubAgentExecution.completed_at must be populated when COMPLETED")
		assert.NotEmpty(t, sa.GetOutput(),
			"SubAgentExecution.output must be populated when COMPLETED")

	case agentexecv1.SubAgentStatus_SUB_AGENT_FAILED:
		assert.NotEmpty(t, sa.GetCompletedAt(),
			"SubAgentExecution.completed_at must be populated when FAILED")
		assert.NotEmpty(t, sa.GetError(),
			"SubAgentExecution.error must be populated when FAILED")

	case agentexecv1.SubAgentStatus_SUB_AGENT_CANCELLED:
		assert.NotEmpty(t, sa.GetCompletedAt(),
			"SubAgentExecution.completed_at must be populated when CANCELLED")

	case agentexecv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS,
		agentexecv1.SubAgentStatus_SUB_AGENT_PENDING:
		// Non-terminal states — timestamps and output are not yet expected.

	default:
		t.Errorf("SubAgentExecution.status has unexpected value: %s", status.String())
	}
}

// LogSubAgentExecutions logs all sub-agent execution details for diagnostics.
func LogSubAgentExecutions(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	subAgents := exec.GetStatus().GetSubAgentExecutions()
	t.Logf("DIAGNOSTIC: %d sub-agent execution(s)", len(subAgents))
	for i, sa := range subAgents {
		t.Logf("DIAGNOSTIC:   sa[%d] id=%s name=%s subject=%q status=%s messages=%d "+
			"started=%s completed=%s output_len=%d error=%q",
			i, sa.GetId(), sa.GetName(), sa.GetSubject(), sa.GetStatus().String(),
			len(sa.GetMessages()), sa.GetStartedAt(), sa.GetCompletedAt(),
			len(sa.GetOutput()), sa.GetError())
	}
}

// AssertPendingApprovals verifies the number of pending approvals.
func AssertPendingApprovals(t *testing.T, exec *agentexecv1.AgentExecution, expectedCount int) {
	t.Helper()
	actual := len(exec.GetStatus().GetPendingApprovals())
	assert.Equal(t, expectedCount, actual,
		"expected %d pending approvals, got %d", expectedCount, actual)
}

// LogExecutionMessages fetches the current execution state and logs all
// messages for diagnostic purposes. Useful when a test fails unexpectedly
// (e.g., LLM didn't call a tool) to distinguish infra bugs from LLM
// non-determinism.
func LogExecutionMessages(t *testing.T, ctx context.Context, clients *Clients, executionID string) {
	t.Helper()
	exec, err := clients.AgentExecutionQuery.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
	if err != nil {
		t.Logf("DIAGNOSTIC: failed to fetch execution %s for message dump: %v", executionID, err)
		return
	}

	t.Logf("DIAGNOSTIC: execution %s phase=%s, messages=%d",
		executionID, exec.GetStatus().GetPhase(), len(exec.GetStatus().GetMessages()))
	for i, msg := range exec.GetStatus().GetMessages() {
		toolCalls := msg.GetToolCalls()
		if len(toolCalls) > 0 {
			for _, tc := range toolCalls {
				t.Logf("DIAGNOSTIC:   msg[%d] type=%s tool_call=%s", i, msg.GetType(), tc.GetName())
			}
		} else {
			content := msg.GetContent()
			if len(content) > 200 {
				content = content[:200] + "..."
			}
			t.Logf("DIAGNOSTIC:   msg[%d] type=%s content=%q", i, msg.GetType(), content)
		}
	}
}
