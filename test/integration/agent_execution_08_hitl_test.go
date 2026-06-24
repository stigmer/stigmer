//go:build integration

package integration

import (
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

// requireHITLPrereqs ensures the test MCP server binary is built and available.
// HITL tests require both a runner and the test MCP server with approval-requiring tools.
func requireHITLPrereqs(t *testing.T, h harness.HarnessConfig) {
	t.Helper()
	h.Skip(t, testHarness)
	if mcpTestServerBinary == "" {
		t.Skip("test MCP server binary not built — skipping HITL test")
	}
}

func TestAgentExecution_HITL_Approve(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)
			harness.SkipCursorForHITLGate(t, h)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-approve-"+h.Name,
				"You MUST call the echo tool exactly once with the user's input, then stop. Never respond with text only. Do not call any tool again.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true, Message: "Execute echo tool"},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the echo tool with input 'hello-hitl'. You must use the tool.",
				2*time.Minute,
				harness.WithAutoApproveAll(false))

			harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
			harness.AssertPendingApprovals(t, waiting, 1)

			approval := waiting.GetStatus().GetPendingApprovals()[0]
			t.Logf("pending approval: tool=%s, id=%s", approval.GetToolName(), approval.GetToolCallId())

			// The server persists an append-only approval-event stream alongside the
			// authoritative message scan. While WAITING it must already carry a
			// REQUESTED event for the gated tool call, and projecting that persisted
			// stream must reproduce pending_approvals exactly (the Scope-A parity that
			// must hold before the source of truth can flip).
			waitingStream := waiting.GetStatus().GetApprovalEventStream()
			require.NotNil(t, waitingStream, "WAITING execution must persist an approval_event_stream")
			require.True(t,
				hitlStreamHasEvent(waitingStream, approval.GetToolCallId(),
					agentexecv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED),
				"persisted stream must carry a REQUESTED event for the pending tool call")

			result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
				exec.GetMetadata().GetId(),
				agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
				3*time.Minute,
			)
			require.NoError(t, err, "execution should complete after approval")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			// After approval, the stream carries the matching decision event authored
			// by SubmitApproval (the rich, audit-bearing record the flat ToolCall
			// fields cannot hold).
			finalStream := result.GetStatus().GetApprovalEventStream()
			require.True(t,
				hitlStreamHasEvent(finalStream, approval.GetToolCallId(),
					agentexecv1.ApprovalEventType_APPROVAL_EVENT_TYPE_APPROVED),
				"persisted stream must carry the APPROVED decision event after approval")
		})
	}
}

// hitlStreamHasEvent reports whether the persisted approval-event stream contains
// an event of the given type for the given approval request (== tool_call_id).
func hitlStreamHasEvent(stream *agentexecv1.ApprovalEventStream, requestID string, eventType agentexecv1.ApprovalEventType) bool {
	for _, ev := range stream.GetEvents() {
		if ev.GetApprovalRequestId() == requestID && ev.GetEventType() == eventType {
			return true
		}
	}
	return false
}

func TestAgentExecution_HITL_Skip(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)
			harness.SkipCursorForHITLGate(t, h)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-skip-"+h.Name,
				"You MUST call the echo tool exactly once with the user's input, then stop. Never respond with text only. Do not call any tool again.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			exec, _ := waiter.WaitForApprovalWithRetry(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the echo tool with input 'test-skip'. You must use the tool.",
				2*time.Minute,
				harness.WithAutoApproveAll(false))

			result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
				exec.GetMetadata().GetId(),
				agentexecv1.ApprovalAction_APPROVAL_ACTION_SKIP,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
				3*time.Minute,
			)
			require.NoError(t, err, "execution should complete after skip")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

func TestAgentExecution_HITL_Reject(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)
			harness.SkipCursorForHITLGate(t, h)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-reject-"+h.Name,
				"You MUST call the echo tool exactly once with the user's input, then stop. Never respond with text only. Do not call any tool again.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			exec, _ := waiter.WaitForApprovalWithRetry(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the echo tool with input 'test-reject'. You must use the tool.",
				2*time.Minute,
				harness.WithAutoApproveAll(false))

			result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
				exec.GetMetadata().GetId(),
				agentexecv1.ApprovalAction_APPROVAL_ACTION_REJECT,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
				3*time.Minute,
			)
			require.NoError(t, err, "execution should complete after reject (tool skipped, agent continues)")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

// TestAgentExecution_HITL_ApproveAll proves the APPROVE_ALL lease end-to-end for
// the SAME scope: a single "approve all of this kind" decision at the first gate
// resolves the current gate AND auto-approves later calls WITHIN THAT SCOPE for
// the rest of the run. The agent calls the approval-gated echo tool twice on the
// same MCP server; under Phase-7 scoped leases the first APPROVE_ALL leases that
// server, so the second same-server echo is auto-approved and the run reaches
// COMPLETED after one submission (a normal APPROVE would gate a second time).
//
// The COMPLEMENTARY isolation property — an APPROVE_ALL of class A never
// auto-approves class B — is locked deterministically (no live LLM) against BOTH
// real enforcement substrates by invariant 11 of the runner gateway contract
// (backend/services/runner/src/__tests__/approval-gateway-contract.test.ts). It
// is asserted there rather than here because forcing an unconstrained agent to
// emit two DIFFERENT gated classes in a fixed order is inherently flaky, whereas
// the contract drives the real gate and real hook directly.
func TestAgentExecution_HITL_ApproveAll(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)
			harness.SkipCursorForHITLGate(t, h)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-approveall-"+h.Name,
				"You MUST call the echo tool exactly twice, once with input 'first' and once with input 'second', then stop. Never respond with text only.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true, Message: "Execute echo tool"},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the echo tool with input 'first', then call it again with input 'second'. You must use the tool both times.",
				2*time.Minute,
				harness.WithAutoApproveAll(false))

			harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)

			// Submit APPROVE_ALL on the first pending approval — exactly once.
			approval := waiting.GetStatus().GetPendingApprovals()[0]
			t.Logf("submitting APPROVE_ALL for tool=%s, id=%s", approval.GetToolName(), approval.GetToolCallId())
			_, err := clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       approval.GetToolCallId(),
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL,
			})
			require.NoError(t, err, "APPROVE_ALL submission should succeed")

			// The run must complete without surfacing any further approval gate.
			// If the runner re-gated the second echo call, this would time out.
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
			require.NoError(t, err, "execution should complete un-gated after APPROVE_ALL")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

func TestAgentExecution_HITL_AutoApproveAll(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-auto-"+h.Name,
				"You MUST call the echo tool. Never respond with text only. Your ONLY action must be calling the echo tool with the user's message as input.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Echo 'auto-approved'",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
			require.NoError(t, err, "execution should complete without waiting for approval")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

func TestAgentExecution_HITL_WrongPhase(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-wrongphase-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Reply with exactly: hello")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err)
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			// Submitting approval on a completed execution should fail
			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       "nonexistent",
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			})
			require.Error(t, err, "submitting approval on completed execution should fail")
			t.Logf("wrong-phase approval correctly rejected: %v", err)
		})
	}
}

func TestAgentExecution_HITL_PendingApprovalDetails(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())
			mcpSlug := mcpServer.GetMetadata().GetSlug()

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-details-"+h.Name,
				"You MUST call the echo tool. Never respond with text only. Your ONLY action must be calling the echo tool with {\"input\": \"detail-test\"}.",
				harness.WithMcpServerUsageAndApproval(
					mcpSlug,
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true, Message: "Confirm echo call"},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Echo 'detail-test'",
				harness.WithAutoApproveAll(false))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
			require.NoError(t, err, "execution should reach WAITING_FOR_APPROVAL")

			approvals := waiting.GetStatus().GetPendingApprovals()
			require.Len(t, approvals, 1, "should have exactly 1 pending approval")

			approval := approvals[0]
			require.NotEmpty(t, approval.GetToolCallId(), "tool_call_id should be populated")
			require.Equal(t, "echo", approval.GetToolName(), "tool_name should be 'echo'")
			require.Equal(t, mcpSlug, approval.GetMcpServerSlug(),
				"mcp_server_slug should match the MCP server used")

			// Why-gated provenance: the gate's policy-source verdict is projected
			// onto the PendingApproval so the UI can explain the gate while the
			// tool is still waiting. echo is gated by a per-agent override, so the
			// source must be AGENT_OVERRIDE (and never UNSPECIFIED).
			require.NotEqual(t,
				agentexecv1.ApprovalPolicySource_APPROVAL_POLICY_SOURCE_UNSPECIFIED,
				approval.GetApprovalPolicySource(),
				"pending approval must carry a why-gated authorization provenance")
			require.Equal(t,
				agentexecv1.ApprovalPolicySource_APPROVAL_POLICY_SOURCE_AGENT_OVERRIDE,
				approval.GetApprovalPolicySource(),
				"echo is gated by a per-agent override")

			t.Logf("approval details: tool_call_id=%s, tool_name=%s, mcp_slug=%s, source=%s, args_preview=%s",
				approval.GetToolCallId(), approval.GetToolName(),
				approval.GetMcpServerSlug(), approval.GetApprovalPolicySource(),
				approval.GetArgsPreview())

			// Clean up: approve so the execution can terminate
			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       approval.GetToolCallId(),
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			})
			require.NoError(t, err)

			result, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
			require.NoError(t, err)

			// The authorization provenance must SURVIVE on the persisted tool call
			// after the approval lands — it rides update_status like tool_kind and
			// is never stripped by the SubmitApproval field preserver.
			persisted := harness.FindToolCall(result, "echo")
			require.NotNil(t, persisted, "the authorized echo tool call must be persisted")
			require.NotEqual(t,
				agentexecv1.ApprovalPolicySource_APPROVAL_POLICY_SOURCE_UNSPECIFIED,
				persisted.GetApprovalPolicySource(),
				"the persisted authorized tool call must carry a non-UNSPECIFIED source")
			require.NotEmpty(t, persisted.GetPolicyEngineVersion(),
				"the persisted authorized tool call must record the policy engine version")
		})
	}
}

func TestAgentExecution_HITL_IdempotentApproval(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-idempotent-"+h.Name,
				"You MUST call the echo tool. Never respond with text only. Your ONLY action must be calling the echo tool with the user's message as input.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Echo 'idempotent-test'",
				harness.WithAutoApproveAll(false))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
			require.NoError(t, err)

			approval := waiting.GetStatus().GetPendingApprovals()[0]

			// First approval
			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       approval.GetToolCallId(),
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			})
			require.NoError(t, err, "first approval should succeed")

			// Second approval (same tool_call_id) should be a no-op, not an error
			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       approval.GetToolCallId(),
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			})
			// Idempotent: either succeeds silently or returns a benign error
			if err != nil {
				t.Logf("second approval returned (expected no-op or benign error): %v", err)
			}

			result, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
			require.NoError(t, err, "execution should reach terminal")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

// TestAgentExecution_HITL_CancelAtGate is the end-to-end proof for the
// terminal-execution arm of the two-mechanism retraction design. An execution
// parked at the approval gate is cancelled WITHOUT a decision. Post-flip this is
// the worst regression risk: the append-only stream still carries the REQUESTED
// event, so a naive event projection would report a phantom pending approval on a
// dead execution forever.
//
// What this test locks against the real runner:
//   - The cancelled execution reports ZERO pending_approvals — terminal executions
//     are handled by the phase-aware projection seam, not by a per-call event.
//   - The persisted stream is PRESERVED for audit (the REQUESTED survives); cancel
//     deliberately does NOT author a per-call RETRACTED (that is reserved for
//     in-flight orphans on a still-live execution).
//   - The workflow neither hangs nor fail-fasts: it lands cleanly in CANCELLED.
func TestAgentExecution_HITL_CancelAtGate(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)
			harness.SkipCursorForHITLGate(t, h)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-cancel-gate-"+h.Name,
				"You MUST call the echo tool exactly once with the user's input, then stop. Never respond with text only. Do not call any tool again.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true, Message: "Execute echo tool"},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the echo tool with input 'cancel-at-gate'. You must use the tool.",
				2*time.Minute,
				harness.WithAutoApproveAll(false))

			harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
			harness.AssertPendingApprovals(t, waiting, 1)

			approval := waiting.GetStatus().GetPendingApprovals()[0]
			waitingStream := waiting.GetStatus().GetApprovalEventStream()
			require.NotNil(t, waitingStream, "WAITING execution must persist an approval_event_stream")
			require.True(t,
				hitlStreamHasEvent(waitingStream, approval.GetToolCallId(),
					agentexecv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED),
				"persisted stream must carry a REQUESTED event for the pending tool call")

			// Cancel while parked at the gate — no decision is ever submitted.
			_, err := clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "cancel should succeed")

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_CANCELLED, 2*time.Minute)
			require.NoError(t, err, "execution should reach CANCELLED, not hang at the gate")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_CANCELLED)

			// The terminal execution must report zero pending approvals — the
			// phase-aware seam, not a per-call retraction, owns this.
			harness.AssertPendingApprovals(t, result, 0)

			// The audit trail is preserved: the REQUESTED still stands, and cancel did
			// NOT manufacture a per-call RETRACTED (terminal != in-flight orphan).
			finalStream := result.GetStatus().GetApprovalEventStream()
			require.NotNil(t, finalStream, "cancelled execution must preserve its approval_event_stream")
			require.True(t,
				hitlStreamHasEvent(finalStream, approval.GetToolCallId(),
					agentexecv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED),
				"cancel must preserve the REQUESTED event for audit")
			require.False(t,
				hitlStreamHasEvent(finalStream, approval.GetToolCallId(),
					agentexecv1.ApprovalEventType_APPROVAL_EVENT_TYPE_RETRACTED),
				"cancel-at-gate is a terminal exit; it must not author a per-call RETRACTED")
		})
	}
}
