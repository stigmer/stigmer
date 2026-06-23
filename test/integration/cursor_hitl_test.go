//go:build integration

package integration

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCursorHarness_HITL_WriteGate_Approve is the end-to-end proof that the
// Cursor harness human-in-the-loop gate works for a real, UNCONSTRAINED agent.
//
// It deliberately does NOT tell the agent which tool to use or to "stop after
// one call" — the previous version of this test over-constrained the agent and
// asserted a fabricated PascalCase tool name, which masked the real regression
// (the hook and the SDK stream use different tool taxonomies, so the approval
// never correlated to the streamed tool call). Here we give a natural task and
// assert the real end-user experience:
//  1. The agent edits a file (the SDK streams it as `edit`; the hook denies it
//     as `Write`).
//  2. The execution surfaces WAITING_FOR_APPROVAL with a pending approval whose
//     tool call is the REAL streamed tool marked WAITING_APPROVAL.
//  3. The user APPROVES.
//  4. The reinvocation grant (keyed by the exact resource) lets the re-attempt
//     through and the execution completes with the file written.
//
// Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_WriteGate_Approve(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-write-approve",
		"You are a helpful coding assistant.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// auto_approve_all=false → the file mutation must pause at the approval gate.
	// Natural task: no tool prescription, no "stop after one call".
	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called gated.txt containing exactly the text: hello-hitl.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"cursor harness should surface a pending approval for the gated file mutation")

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	t.Logf("pending approval: tool=%s, id=%s, message=%q",
		approval.GetToolName(), approval.GetToolCallId(), approval.GetMessage())
	assert.True(t, isGatedMutatingTool(approval.GetToolName()),
		"expected a gated mutating tool (write/edit/shell/delete in either taxonomy), got %q",
		approval.GetToolName())

	// Load-bearing invariant: the backend projects pending_approvals from
	// tool-call status, so the gated tool call must itself carry WAITING_APPROVAL
	// (not COMPLETED). This is the exact regression that hid the approval gate —
	// and it must be the REAL streamed tool call, not a synthesized placeholder.
	assertToolCallWaitingApproval(t, waiting, approval.GetToolCallId())

	// Approve and let the reinvocation grant carry the re-attempted edit through.
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete after the file mutation is approved")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// The approved mutation must have actually executed on the resumed turn —
	// proving the exact-resource grant let the re-attempt (fresh tool-call id)
	// through.
	assertCompletedWrite(t, result)
}

// TestCursorHarness_HITL_AdversarialShellWorkaround_StillGated proves the agent
// cannot bypass the gate by "working around" a blocked file edit with the shell.
// The Cursor shell tool is `execute` (hook `Shell`) and is gated too, so an
// agent that is explicitly told to improvise must STILL pause for approval and
// must NOT complete any mutating tool. This is the adversarial scenario the old
// over-constrained test could never exercise. Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_AdversarialShellWorkaround_StillGated(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-adversarial",
		"You are a resourceful coding assistant. If one approach is blocked, you "+
			"try alternative approaches to accomplish the task.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Explicitly invite the agent to bypass the gate via the shell. The gate must
	// hold: the execution pauses at WAITING_FOR_APPROVAL rather than completing.
	_, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called adversarial.txt containing the text: hi. "+
			"If your file-editing tool is blocked, work around it by using the "+
			"shell (e.g. echo) to create the file instead.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"the gate must hold even when the agent is told to work around it via the shell")

	// Every surfaced approval must be a gated mutating tool (edit or shell), and
	// crucially NO mutating tool may have COMPLETED — the workaround was gated too.
	for _, pa := range waiting.GetStatus().GetPendingApprovals() {
		assert.True(t, isGatedMutatingTool(pa.GetToolName()),
			"pending approval %q should be a gated mutating tool", pa.GetToolName())
	}
	assertNoMutatingToolCompleted(t, waiting)
}

// TestCursorHarness_HITL_ResumedTurn_StillGated reproduces the production
// regression where the approval gate silently vanished on every turn after the
// first (aex_01ktr5na07f5xtmn0dz3mfjtdp): Agent.resume() does not persist
// local.cwd, and when the runner omitted it the SDK re-rooted the resumed agent
// at the runner's own process.cwd() — loading the "project" setting source (the
// .cursor/hooks.json carrying the HITL preToolUse hook) from the wrong
// directory. Result: turn 1 was gated, but every subsequent message in the same
// session ran file edits and shell commands unguarded to COMPLETED.
//
// The test runs a benign first turn to completion (creates the agent), then
// requests a file mutation on the SECOND turn (resumes the agent) and asserts
// the gate still holds. Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_ResumedTurn_StillGated(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-resumed-turn",
		"You are a helpful coding assistant.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Turn 1: benign, read-only prompt — completes and persists the Cursor
	// agentId as harness_state_id so turn 2 takes the Agent.resume() path.
	first := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Reply with the single word: ready. Do not use any tools.",
		harness.WithAutoApproveAll(false),
	)
	firstResult, err := waiter.WaitForPhase(ctx, first.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, first.GetMetadata().GetId())
	}
	require.NoError(t, err, "benign first turn should complete")
	harness.AssertAgentPhase(t, firstResult, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Turn 2: the mutation. The resumed agent must still load the project HITL
	// hook, so the gate must hold exactly as it does on a fresh agent.
	_, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called resumed-gate.txt containing exactly the text: hello-resume.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"the approval gate must hold on a resumed turn (second message in the session)")

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	assert.True(t, isGatedMutatingTool(approval.GetToolName()),
		"expected a gated mutating tool on the resumed turn, got %q", approval.GetToolName())
	assertToolCallWaitingApproval(t, waiting, approval.GetToolCallId())
	assertNoMutatingToolCompleted(t, waiting)
}

// TestCursorHarness_HITL_AutoApproveAll_NoGate verifies the bypass: with
// auto_approve_all=true the same file mutation executes without ever pausing for
// approval. Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_AutoApproveAll_NoGate(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-write-autoapprove",
		"You are a helpful coding assistant.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called auto.txt containing exactly the text: hello-auto.",
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete directly with auto_approve_all")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// No approval should ever have been surfaced.
	assert.Empty(t, result.GetStatus().GetPendingApprovals(),
		"auto_approve_all=true must not surface any approval gate")
	assertCompletedWrite(t, result)
}

// TestCursorHarness_HITL_McpToolGate_Approve is the missing end-to-end proof
// that the Cursor harness approval gate fires for an MCP tool — not just a
// built-in — and the empirical capture for the Phase 0 root-cause question.
//
// Until now the cross-harness MCP HITL test skipped the Cursor harness
// (harness.SkipCursorForHITLGate) "pending live preToolUse verification": no
// test had ever paused a Cursor execution on an MCP tool. This closes that gap.
// It forces a deterministic MCP tool (the mock server's "echo") to require
// approval via a per-agent override, drives a real cursor-agent to invoke it,
// and asserts the execution pauses at WAITING_FOR_APPROVAL with the gated MCP
// tool call marked WAITING_APPROVAL — then approves and runs to completion via
// the reinvocation grant.
//
// It also captures ground truth for the HITL UX bug (see
// inspectCursorMcpDenyGroundTruth): when CURSOR_EVENT_RECORD_DIR is set, it
// reports whether Cursor surfaced our hook's deny agent_message to the model or
// replaced it with its own generic "blocked by a hook" text — the asymmetry that
// makes the model narrate defeat. That part is logged, never asserted, because
// it characterizes upstream SDK behavior we do not control.
//
// Requires CURSOR_API_KEY. For the ground-truth capture, also export
// CURSOR_EVENT_RECORD_DIR (a writable dir) before the suite starts the runner.
func TestCursorHarness_HITL_McpToolGate_Approve(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// Deterministic MCP tool forced to require approval. Using a per-agent
	// override isolates the MCP approval path from the built-in gate already
	// covered by TestCursorHarness_HITL_WriteGate_Approve.
	httpServer := harness.StartHTTPMcpServer(t)
	mcpServer := harness.CreateHttpMcpServer(t, ctx, clients, httpServer.URL)
	harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())
	harness.WaitForMcpServerTool(t, ctx, clients,
		mcpServer.GetMetadata().GetId(), "echo", 2*time.Minute)

	agent := harness.CreateAgent(t, ctx, clients, "test-cursor-hitl-mcp-gate",
		"You are a helpful assistant. When asked to use a tool, invoke it "+
			"directly via a tool call.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{{ToolName: "echo", RequiresApproval: true}},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// auto_approve_all=false → the gated MCP tool must pause at the approval gate.
	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Call the MCP tool named \"echo\" with input \"hello\", wait for its "+
			"result, then reply with the single word DONE.",
		4*time.Minute,
		harness.WithAutoApproveAll(false),
	)

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"cursor harness must surface a pending approval for the gated MCP tool")

	approval := harness.FindPendingApproval(waiting, "echo")
	require.NotNil(t, approval,
		"expected a pending approval for the MCP tool \"echo\" — the beforeMCPExecution gate did not surface it")
	t.Logf("pending MCP approval: tool=%s id=%s message=%q",
		approval.GetToolName(), approval.GetToolCallId(), approval.GetMessage())

	// Load-bearing invariant (same as the built-in gate): the backend projects
	// pending_approvals from tool-call status, so the gated MCP tool call must
	// itself carry WAITING_APPROVAL.
	assertToolCallWaitingApproval(t, waiting, approval.GetToolCallId())

	// Phase 0 ground truth: what did the model actually see on the MCP deny?
	inspectCursorMcpDenyGroundTruth(t, exec.GetMetadata().GetId(), "echo")

	// Approve; the reinvocation grant (name-keyed for MCP tools) must let the
	// re-attempted call through to completion.
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		4*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete after the MCP tool is approved")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
}

// approvalRequiredAgentMessageMarker is a stable substring of the hook's deny
// agent_message (hook-script.ts APPROVAL_REQUIRED_AGENT_MESSAGE). If the raw SDK
// stream contains it, Cursor forwarded our message to the model; if instead it
// only contains "blocked by a hook", Cursor replaced it with its own generic
// text — the root cause of the defeatist "fix your Cursor settings" narration.
const approvalRequiredAgentMessageMarker = "submitted to the user for approval automatically"

// inspectCursorMcpDenyGroundTruth reads the raw @cursor/sdk event stream (when
// CURSOR_EVENT_RECORD_DIR is set) and reports whether the denied MCP tool's
// model-visible result carried our hook agent_message or Cursor's generic
// "blocked by a hook" text. Pure diagnostics — it characterizes upstream SDK
// behavior we do not control, so it logs findings and never fails the test.
func inspectCursorMcpDenyGroundTruth(t *testing.T, execID, toolName string) {
	t.Helper()

	// Log the captured result shape (byte-heavy strings redacted) for the record.
	logCapturedCursorToolResult(t, execID, toolName)

	dir := os.Getenv("CURSOR_EVENT_RECORD_DIR")
	if dir == "" {
		t.Logf("PHASE 0 ground truth: CURSOR_EVENT_RECORD_DIR not set — export it to a " +
			"writable dir before the suite starts the runner to capture the model-visible deny text")
		return
	}

	path := filepath.Join(dir, execID+".cursor-events.jsonl")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Logf("PHASE 0 ground truth: could not read recorded cursor events at %s: %v", path, err)
		return
	}

	raw := string(data)
	sawBlockedByHook := strings.Contains(raw, "blocked by a hook")
	sawOurMessage := strings.Contains(raw, approvalRequiredAgentMessageMarker)
	t.Logf("PHASE 0 GROUND TRUTH (MCP deny, tool=%q): model saw 'blocked by a hook'=%v, "+
		"saw our hook agent_message=%v", toolName, sawBlockedByHook, sawOurMessage)
	if sawBlockedByHook && !sawOurMessage {
		t.Logf("PHASE 0 CONFIRMED: Cursor replaced our deny agent_message with its generic " +
			"'blocked by a hook' text on the MCP path — the model has no signal that this is " +
			"an approval-in-progress (the root cause of the defeatist narration; drives the " +
			"runner-side clean-pause and the .cursor/rules escalation).")
	}
}

// assertToolCallWaitingApproval asserts the gated tool call carries
// TOOL_CALL_WAITING_APPROVAL + requires_approval. The backend's
// PendingApprovalComputer projects pending_approvals from exactly this status,
// so this is the invariant that makes the approval gate surface at all.
func assertToolCallWaitingApproval(t *testing.T, exec *agentexecv1.AgentExecution, toolCallID string) {
	t.Helper()
	for _, msg := range exec.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetId() != toolCallID {
				continue
			}
			assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, tc.GetStatus(),
				"gated tool call %s must be WAITING_APPROVAL (drives the pending_approvals projection)", toolCallID)
			assert.True(t, tc.GetRequiresApproval(),
				"gated tool call %s must have requires_approval=true", toolCallID)
			return
		}
	}
	t.Errorf("tool call %s not found in waiting execution messages", toolCallID)
}

// isGatedMutatingTool reports whether a tool name is a gated mutating tool in
// EITHER taxonomy the platform sees: the SDK stream (lowercase `edit`/`shell`/
// `delete`/`write`/`execute`) or the preToolUse hook (PascalCase `Write`/
// `StrReplace`/`EditNotebook`/`Shell`/`Delete`). Lowercasing collapses both.
// Kept in sync with approvalCategory() in approval-policy.ts.
func isGatedMutatingTool(name string) bool {
	switch strings.ToLower(name) {
	case "write", "edit", "strreplace", "editnotebook",
		"shell", "execute", "delete":
		return true
	default:
		return false
	}
}

// assertCompletedWrite asserts the persisted messages contain a write-like tool
// call that completed (not stuck WAITING_APPROVAL/RUNNING).
func assertCompletedWrite(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	for _, tc := range collectToolCalls(exec.GetStatus().GetMessages()) {
		name := strings.ToLower(tc.GetName())
		isWrite := strings.Contains(name, "write") || strings.Contains(name, "edit") ||
			name == "strreplace"
		if isWrite && tc.GetStatus() == agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED {
			t.Logf("approved write executed: tool=%s, status=%s", tc.GetName(), tc.GetStatus())
			return
		}
	}
	t.Errorf("expected a COMPLETED write tool call in persisted messages; none found")
}

// assertNoMutatingToolCompleted asserts that, while gated, NO mutating tool
// reached COMPLETED — proving the agent could not bypass the gate.
func assertNoMutatingToolCompleted(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	for _, tc := range collectToolCalls(exec.GetStatus().GetMessages()) {
		if isGatedMutatingTool(tc.GetName()) &&
			tc.GetStatus() == agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED {
			t.Errorf("mutating tool %q completed without approval — the gate was bypassed", tc.GetName())
		}
	}
}
