//go:build integration

package offline

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Offline HITL approval-flow tests (Cloud edition) ---
//
// These run against the MockLLMProxyServer (no provider keys) and the real Java
// stigmer-service + TS runner. They are the deterministic, pre-manual-test gate
// for the human-in-the-loop invariants that the live (real-LLM) suite in
// agent_execution_08_hitl_test.go proves non-deterministically.
//
// What they prove — the Cloud-edition ORCHESTRATION: the Java workflow wait ->
// approvalGateResolved signal -> activity re-invoke loop, the SubmitApproval
// handler (single, bulk co-pending, and APPROVE_ALL lease derivation from
// persisted state), and the append-only approval_event_stream the source-of-truth
// flip depends on.
//
// What they deliberately do NOT prove — runner-internal DURABLE-RESUME branching.
// Offline uses the ephemeral MemorySaver checkpointer (shared/checkpointer/
// factory.ts), so a gated execution replays from scratch each invocation rather
// than resuming via Command(resume)/seedStatusFromExecution; the mock-LLM cursor
// stays aligned because each gated turn makes exactly one LLM call before
// re-pausing. A consequence is that the production REJECT -> EXECUTION_FAILED path
// is not exercised here (this is why TestOffline_HITL_Reject asserts COMPLETED,
// not FAILED): that branch and transcript accumulation are covered by the runner
// unit tests and the live suite. Tests that depend on the lease surviving across
// a re-invocation lean on it being derived from server-persisted status
// (deriveActiveLeases), not from the lost in-graph checkpoint.

// hitlToolCallEntries returns mock LLM entries for a simple HITL flow:
// Turn 1: LLM calls echo tool (triggers approval gate)
// Turn 2: LLM produces text summary after tool result
func hitlToolCallEntries() []harness.RecordedLLMEntry {
	return []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_hitl_01", "echo", map[string]any{"input": "hello-hitl"},
			300, 35,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"The echo tool returned the result.", 500, 20,
		)),
	}
}

// hitlSkipRejectEntries returns mock LLM entries where the tool is
// skipped/rejected. After the tool is skipped, the LLM responds with text.
func hitlSkipRejectEntries() []harness.RecordedLLMEntry {
	return []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_hitl_sr", "echo", map[string]any{"input": "test-skip-reject"},
			300, 35,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"The tool call was not executed. I'll proceed without it.",
			400, 25,
		)),
	}
}

func TestOffline_HITL_Approve(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlToolCallEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-approve",
		"You MUST call the echo tool exactly once with the user's input, then stop.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true, Message: "Execute echo tool"},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Call the echo tool with input 'hello-hitl'. You must use the tool.",
		harness.WithAutoApproveAll(false))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err, "execution should reach WAITING_FOR_APPROVAL")

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	harness.AssertPendingApprovals(t, waiting, 1)

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	assert.Equal(t, "echo", approval.GetToolName())
	t.Logf("pending approval: tool=%s, id=%s", approval.GetToolName(), approval.GetToolCallId())

	// The server persists an append-only approval-event stream alongside the
	// authoritative message scan. While WAITING it must already carry a REQUESTED
	// event for the gated tool call — the audit ledger the source-of-truth flip
	// projects pending_approvals from. Asserting it here gives the deterministic
	// Cloud-edition analogue of the live suite's stream check (no provider keys).
	waitingStream := waiting.GetStatus().GetApprovalEventStream()
	require.NotNil(t, waitingStream, "WAITING execution must persist an approval_event_stream")
	require.True(t,
		harness.ApprovalStreamHasEvent(waitingStream, approval.GetToolCallId(),
			agentexecv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED),
		"persisted stream must carry a REQUESTED event for the pending tool call")

	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		2*time.Minute,
	)
	require.NoError(t, err, "execution should complete after approval")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// After the decision lands, the same stream carries the matching APPROVED
	// event authored by SubmitApproval — the rich, audit-bearing record the flat
	// ToolCall fields cannot hold. The stream is a server-authored status field,
	// independent of the offline transcript-replay limitation, so this holds
	// against the same Java service the live suite exercises.
	finalStream := result.GetStatus().GetApprovalEventStream()
	require.NotNil(t, finalStream, "completed execution must preserve its approval_event_stream")
	require.True(t,
		harness.ApprovalStreamHasEvent(finalStream, approval.GetToolCallId(),
			agentexecv1.ApprovalEventType_APPROVAL_EVENT_TYPE_APPROVED),
		"persisted stream must carry the APPROVED decision event after approval")

	t.Logf("offline HITL approve test passed")
}

func TestOffline_HITL_Skip(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlSkipRejectEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-skip",
		"You MUST call the echo tool exactly once with the user's input, then stop.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Call the echo tool with input 'test-skip'. You must use the tool.",
		harness.WithAutoApproveAll(false))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	_, err = waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err)

	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_SKIP,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		2*time.Minute,
	)
	require.NoError(t, err, "execution should complete after skip")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("offline HITL skip test passed")
}

func TestOffline_HITL_Reject(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlSkipRejectEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-reject",
		"You MUST call the echo tool exactly once with the user's input, then stop.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Call the echo tool with input 'test-reject'. You must use the tool.",
		harness.WithAutoApproveAll(false))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	_, err = waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err)

	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		2*time.Minute,
	)
	require.NoError(t, err, "execution should complete after reject")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("offline HITL reject test passed")
}

func TestOffline_HITL_AutoApproveAll(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlToolCallEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-auto",
		"You MUST call the echo tool. Your ONLY action must be calling the echo tool.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Echo 'auto-approved'",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "execution should complete without waiting for approval")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("offline HITL auto-approve test passed")
}

func TestOffline_HITL_PendingApprovalDetails(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlToolCallEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
	mcpSlug := mcpServer.GetMetadata().GetSlug()

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-details",
		"You MUST call the echo tool. Your ONLY action must be calling the echo tool.",
		harness.WithMcpServerUsageAndApproval(
			mcpSlug,
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true, Message: "Confirm echo call"},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Echo 'detail-test'",
		harness.WithAutoApproveAll(false))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err)

	approvals := waiting.GetStatus().GetPendingApprovals()
	require.Len(t, approvals, 1, "should have exactly 1 pending approval")

	approval := approvals[0]
	assert.NotEmpty(t, approval.GetToolCallId(), "tool_call_id should be populated")
	assert.Equal(t, "echo", approval.GetToolName())
	assert.Equal(t, mcpSlug, approval.GetMcpServerSlug(),
		"mcp_server_slug should match the MCP server used")
	// A gated tool renders from its args preview (the deny-gate carries the
	// proposed change on the args; there is no captured file_changes list — Phase 5
	// Slice 4 removed it).
	assert.NotEmpty(t, approval.GetArgsPreview(),
		"a gated tool must carry an args preview to render")

	t.Logf("approval details: tool_call_id=%s, tool_name=%s, mcp_slug=%s, args_preview=%s",
		approval.GetToolCallId(), approval.GetToolName(),
		approval.GetMcpServerSlug(), approval.GetArgsPreview())

	// Approve to let execution complete
	_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
		AgentExecutionId: exec.GetMetadata().GetId(),
		ToolCallId:       approval.GetToolCallId(),
		Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
	})
	require.NoError(t, err)

	_, err = waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err)

	t.Logf("offline HITL details test passed")
}

// TestOffline_HITL_ApproveAll_ScopedLease proves the Phase-7 run-lifetime lease
// end-to-end against the Java service, deterministically: a single APPROVE_ALL at
// an MCP tool gate leases that server for the rest of the run, so a LATER call to
// the same server — a SEPARATE assistant turn that would otherwise re-gate — is
// auto-approved.
//
// Why an MCP tool rather than write_file: native file writes no longer deny-gate.
// They flow during the turn and are reviewed post-hoc as a FileChangeSet (capture
// mode is unconditional in the deep-agent harness — see execute-deep-agent/
// setup.ts). The genuinely-gating vehicle is therefore an MCP tool, whose
// APPROVE_ALL leases the whole SERVER (LeaseScope: an MCP tool → its server slug;
// a built-in → its category).
//
// What makes this non-tautological AND offline-unique: the second echo is a
// SEPARATE turn (a separate activity invocation), not a co-pending sibling — so
// its auto-approval cannot come from server-side co-pending BULK resolution, only
// from the run-lifetime lease. Offline uses the ephemeral MemorySaver, so that
// invocation replays the graph from scratch; the second echo is auto-approved
// solely because the lease is re-derived from server-persisted status
// (deriveActiveLeases), not from the lost in-graph checkpoint — the exact Cloud
// orchestration property this suite exists to pin. If the lease broke, the second
// echo would re-gate, the run would never reach COMPLETED, and
// mockLLM.Remaining() would stay > 0.
//
// The COMPLEMENTARY isolation property — an APPROVE_ALL of one scope never
// auto-approves a DIFFERENT scope — is locked deterministically on BOTH real
// substrates by invariant 11 of the runner gateway contract
// (backend/services/runner/src/__test-utils__/approval-contract/contract.ts) and,
// on the Java side, by the LeaseScope corpus (hitl/lease-scope/vectors.json). It
// is asserted there rather than re-proven here through redundant e2e machinery
// (a second MCP server), which would add cost without new coverage.
func TestOffline_HITL_ApproveAll_ScopedLease(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		// Turn 1: echo "first" — gates (auto_approve_all=false). We submit
		// APPROVE_ALL here, leasing the MCP server for the rest of the run.
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_aa_echo_1", "echo", map[string]any{"input": "first"},
			300, 40,
		)),
		// Turn 2: echo "second" — SAME server, a separate turn. On the resume's
		// from-scratch replay it must be auto-approved by the persisted lease
		// (must NOT re-gate).
		harness.BuildLLMEntry(1, harness.AnthropicToolUseResponse(
			"toolu_aa_echo_2", "echo", map[string]any{"input": "second"},
			320, 40,
		)),
		// Turn 3: finish once the second echo has run un-gated.
		harness.BuildLLMEntry(2, harness.AnthropicTextResponse(
			"Echoed both inputs.", 340, 20,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-approveall",
		"You are a test agent. Call the echo tool as instructed.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true, Message: "Execute echo tool"},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Call the echo tool with input 'first', then call it again with input 'second'.",
		harness.WithAutoApproveAll(false),
	)
	execID := exec.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// --- Gate 1: echo "first" -> submit APPROVE_ALL (leases the MCP server) ---
	gate1, err := waiter.WaitForPendingApproval(ctx, execID, "echo", 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should gate on the first echo: %v", err)
	}
	harness.AssertAgentPhase(t, gate1, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	harness.AssertPendingApprovals(t, gate1, 1)

	echo1 := gate1.GetStatus().GetPendingApprovals()[0]
	require.Equal(t, "echo", echo1.GetToolName())

	_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
		AgentExecutionId: execID,
		ToolCallId:       echo1.GetToolCallId(),
		Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL,
	})
	require.NoError(t, err, "APPROVE_ALL submission should succeed")

	// The second echo (same server, a separate turn) must NOT re-gate: the
	// persisted server lease survives the from-scratch replay and auto-approves
	// it, so the run drives straight to COMPLETED. A broken lease would re-gate
	// the second echo here (or time out), leaving entries[2] unconsumed.
	result, err := waiter.WaitForPhase(ctx, execID,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "execution should complete un-gated after APPROVE_ALL leases the server")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertPendingApprovals(t, result, 0)
	assert.Equal(t, 0, mockLLM.Remaining(),
		"all scripted turns consumed: the second echo was auto-approved (not re-gated) by the lease")

	t.Logf("offline HITL approve-all scoped-lease test passed")
}

// TestOffline_HITL_CancelAtGate is the deterministic Cloud-edition analogue of
// the live cancel-at-gate proof: an execution parked at the approval gate is
// cancelled WITHOUT a decision. The append-only stream still carries REQUESTED,
// so a naive event projection would report a phantom pending approval on a dead
// execution forever — this locks the phase-aware retraction seam instead. The
// cancel path takes no further LLM call, so it is unaffected by offline replay.
func TestOffline_HITL_CancelAtGate(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlToolCallEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-cancel-gate",
		"You MUST call the echo tool exactly once with the user's input, then stop.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true, Message: "Execute echo tool"},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Call the echo tool with input 'cancel-at-gate'. You must use the tool.",
		harness.WithAutoApproveAll(false))
	execID := exec.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	waiting, err := waiter.WaitForApproval(ctx, execID, 2*time.Minute)
	require.NoError(t, err, "execution should reach WAITING_FOR_APPROVAL")
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	harness.AssertPendingApprovals(t, waiting, 1)

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	waitingStream := waiting.GetStatus().GetApprovalEventStream()
	require.NotNil(t, waitingStream, "WAITING execution must persist an approval_event_stream")
	require.True(t,
		harness.ApprovalStreamHasEvent(waitingStream, approval.GetToolCallId(),
			agentexecv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED),
		"persisted stream must carry a REQUESTED event for the pending tool call")

	// Cancel while parked at the gate — no decision is ever submitted.
	_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
		Id: execID,
	})
	require.NoError(t, err, "cancel should succeed")

	result, err := waiter.WaitForPhase(ctx, execID,
		agentexecv1.ExecutionPhase_EXECUTION_CANCELLED, 2*time.Minute)
	require.NoError(t, err, "execution should reach CANCELLED, not hang at the gate")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_CANCELLED)

	// Terminal execution reports zero pending approvals — the phase-aware seam,
	// not a per-call retraction, owns this.
	harness.AssertPendingApprovals(t, result, 0)

	// Audit trail preserved: REQUESTED still stands, and cancel did NOT author a
	// per-call RETRACTED (terminal exit != in-flight orphan).
	finalStream := result.GetStatus().GetApprovalEventStream()
	require.NotNil(t, finalStream, "cancelled execution must preserve its approval_event_stream")
	require.True(t,
		harness.ApprovalStreamHasEvent(finalStream, approval.GetToolCallId(),
			agentexecv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED),
		"cancel must preserve the REQUESTED event for audit")
	require.False(t,
		harness.ApprovalStreamHasEvent(finalStream, approval.GetToolCallId(),
			agentexecv1.ApprovalEventType_APPROVAL_EVENT_TYPE_RETRACTED),
		"cancel-at-gate is a terminal exit; it must not author a per-call RETRACTED")

	t.Logf("offline HITL cancel-at-gate test passed")
}

// TestOffline_HITL_IdempotentApproval proves that re-submitting the same decision
// on an OPEN gate is a benign no-op. Determinism comes from two co-pending echo
// calls raised by a single turn: approving the first leaves the second pending
// (the gate stays open, so there is no resume race), which is the stable window in
// which the duplicate submit is exercised.
//
// Why MCP echo rather than write_file: native file writes no longer deny-gate —
// they flow and are captured post-hoc (capture mode is unconditional in the
// deep-agent harness). An MCP tool with an approval override is the genuinely-
// gating vehicle; two echo blocks in a single assistant turn surface as two
// co-pending approvals (same tool, distinct tool_call_id).
func TestOffline_HITL_IdempotentApproval(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		// Turn 1: two echo calls in ONE turn -> two co-pending gates.
		harness.BuildLLMEntry(0, harness.AnthropicMultiToolUseResponse(
			[]harness.ToolUseBlock{
				{ID: "toolu_idem_a", Name: "echo", Input: map[string]any{"input": "alpha"}},
				{ID: "toolu_idem_b", Name: "echo", Input: map[string]any{"input": "beta"}},
			},
			300, 60,
		)),
		// Turn 2: finish once both gates are resolved.
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"Echoed both inputs.", 360, 20,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-idempotent",
		"You are a test agent. Call the echo tool as instructed.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true, Message: "Execute echo tool"},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Call the echo tool twice, with inputs 'alpha' and 'beta'.",
		harness.WithAutoApproveAll(false),
	)
	execID := exec.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	waiting, err := waiter.WaitForApproval(ctx, execID, 2*time.Minute)
	require.NoError(t, err, "execution should reach WAITING_FOR_APPROVAL")
	harness.AssertPendingApprovals(t, waiting, 2)

	// Approve the first co-pending gate; the second stays pending so the gate
	// remains open (no resume, no replay).
	_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
		AgentExecutionId: execID,
		ToolCallId:       "toolu_idem_a",
		Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
	})
	require.NoError(t, err, "first approval should succeed")

	// After approving A, exactly B must remain pending (the gate stays open).
	require.Eventually(t, func() bool {
		snap, gErr := clients.AgentExecutionQuery.Get(ctx, &agentexecv1.AgentExecutionId{Value: execID})
		if gErr != nil {
			return false
		}
		pas := snap.GetStatus().GetPendingApprovals()
		return len(pas) == 1 && pas[0].GetToolCallId() == "toolu_idem_b"
	}, 90*time.Second, 500*time.Millisecond,
		"after approving A, exactly B must remain pending")

	// Re-submit the SAME decision on the still-open gate — a benign no-op. It must
	// not error fatally and must not corrupt the open gate (asserted next).
	_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
		AgentExecutionId: execID,
		ToolCallId:       "toolu_idem_a",
		Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
	})
	if err != nil {
		t.Logf("duplicate approval returned (expected no-op or benign error): %v", err)
	}

	// State is unchanged: B is still the only pending approval.
	snap, err := clients.AgentExecutionQuery.Get(ctx, &agentexecv1.AgentExecutionId{Value: execID})
	require.NoError(t, err)
	harness.AssertPendingApprovals(t, snap, 1)
	require.Equal(t, "toolu_idem_b",
		snap.GetStatus().GetPendingApprovals()[0].GetToolCallId(),
		"a duplicate decision on A must not resolve or alter the still-pending B")

	// Approve B to release the gate and drive to completion.
	_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
		AgentExecutionId: execID,
		ToolCallId:       "toolu_idem_b",
		Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
	})
	require.NoError(t, err, "approving B should succeed")

	result, err := waiter.WaitForTerminal(ctx, execID, 2*time.Minute)
	require.NoError(t, err, "execution should reach terminal after both gates resolved")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertPendingApprovals(t, result, 0)
	assert.Equal(t, 0, mockLLM.Remaining(), "all scripted turns consumed")

	t.Logf("offline HITL idempotent-approval test passed")
}
