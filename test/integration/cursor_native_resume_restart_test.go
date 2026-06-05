//go:build integration

package integration

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCursorNativeResume_SurvivesRestart verifies that the Cursor SDK's native
// LOCAL Agent.resume() restores conversation context across a runner (pod)
// restart, when the SDK's SQLite state is present. Native resume is now the
// platform's only continuation mechanism (SessionMemory was removed), so a
// successfully-resumed local agent receives the raw user message — the only way
// it can recall a turn-1 secret is if the SDK rehydrated the conversation from
// its persisted SQLite store.
//
// Faithful pod-restart simulation: the SDK's SQLite state lives under the
// workspace volume ({WORKSPACE_ROOT_DIR}/.stigmer/cursor-sdk-state/{sessionId}),
// which survives a runner Stop()/Start(). Restarting the process discards the
// in-memory executor cache and forces Agent.resume() to rehydrate from disk —
// exactly what a new pod must do.
//
// Soundness: the test asserts BOTH that turn 2 actually went through native
// resume (runner log shows reason=resumed_successfully) AND that the nonce was
// recalled. Without the first assertion, a silent resume failure + fallback
// could make the test pass for the wrong reason.
//
// Requires CURSOR_API_KEY (skips otherwise), following the same provider-gated
// pattern as TestWorkflowCursorCall_FileCanary.
func TestCursorNativeResume_SurvivesRestart(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 12*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// Take over the shared runner's queue with a flagged runner. The Java
	// service dispatches cursor executions to the base queue the suite runner
	// polls; two runners on one queue would round-robin nondeterministically,
	// so we stop the shared runner for the duration and restore it on cleanup.
	probe := newResumeProbe(t, ctx)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-native-resume-agent",
		"You are a precise assistant with perfect memory of this conversation. "+
			"When asked to remember something, remember it exactly. When later "+
			"asked to recall it, reply with only the requested value.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)
	sessionID := session.GetMetadata().GetId()

	// A distinctive token the model cannot guess and that does not appear in
	// any turn-2 prompt — so recall can only come from restored context.
	nonce := "ZEPHYR-" + strings.ToUpper(uuid.New().String()[:8])
	t.Logf("native-resume probe: session=%s nonce=%s", sessionID, nonce)

	// --- Turn 1: establish the secret on the first (created) agent ---
	exec1 := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
		"Remember this exact secret token for later: "+nonce+
			"\nReply with only: ACK",
	)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	res1, err := waiter.WaitForPhase(ctx, exec1.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec1.GetMetadata().GetId())
	}
	require.NoError(t, err, "turn 1 should complete")
	require.NotNil(t, res1)

	// Empirically confirm where the SDK persists local state: the SQLite store
	// must exist under the runner's $HOME after turn 1. This both validates the
	// restart simulation and documents the state location.
	stateDir := cursorStateDir(t, sessionID)
	require.DirExists(t, stateDir,
		"expected the Cursor SDK SQLite state at %s after turn 1 — if absent, the "+
			"runner's stateRoot/HOME differs from the test's and the restart "+
			"simulation is not valid", stateDir)
	t.Logf("confirmed Cursor SDK state present: %s", stateDir)

	// --- Restart the runner (pod restart) with the SQLite state intact ---
	probe.restart(t, ctx)

	// --- Turn 2: ask for the secret; native resume must restore context ---
	exec2 := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
		"What was the secret token I asked you to remember earlier? "+
			"Reply with ONLY the token, nothing else.",
	)
	res2, err := waiter.WaitForPhase(ctx, exec2.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec2.GetMetadata().GetId())
	}
	require.NoError(t, err, "turn 2 should complete")
	require.NotNil(t, res2)

	// Soundness gate: turn 2 must have gone through a successful native resume.
	// If the SDK could not resume, the runner falls back to a fresh agent and
	// the recall (if any) would come from the SessionMemory hack, not native
	// resume — which is precisely what we are NOT testing here.
	assertRunnerLogHasResolution(t, probe.logPath(), exec2.GetMetadata().GetId(),
		"resumed_successfully")

	finalText := lastAIMessageText(res2)
	t.Logf("turn 2 final AI message: %q", finalText)

	recalled := strings.Contains(strings.ToUpper(finalText), nonce)
	assert.True(t, recalled,
		"RESULT: native local Agent.resume() did %s restore conversation context "+
			"across a runner restart (nonce %q %s in the turn-2 reply). Native resume "+
			"is the only continuation mechanism; a false here means the relocated "+
			"SQLite state did not survive the restart.",
		boolWord(recalled, "", "NOT"), nonce, boolWord(recalled, "appeared", "did not appear"))

	if recalled {
		t.Logf("RESULT: native local resume SURVIVED the restart — context was restored from the persisted SQLite store on the workspace volume.")
	}
}

// TestCursorNativeResume_FailsWithoutState is the negative control. It proves
// the positive result depends on the persisted local SQLite store (and is not,
// say, Cursor server-side state): with the SQLite store deleted before the
// follow-up, native Agent.resume() can no longer find the local agent record
// and the runner falls back to a freshly-created agent
// (reason=created_after_resume_failure).
//
// We assert on the resume OUTCOME (the fallback reason in the runner log). The
// fresh agent has no prior context (SessionMemory was removed), so this is the
// sound proof that conversation continuity depends entirely on the persisted
// local SQLite store.
//
// Requires CURSOR_API_KEY (skips otherwise).
func TestCursorNativeResume_FailsWithoutState(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 12*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	probe := newResumeProbe(t, ctx)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-resume-negctl-agent",
		"You are a precise assistant. Reply concisely.",
	)
	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)
	sessionID := session.GetMetadata().GetId()
	nonce := "ORBIT-" + strings.ToUpper(uuid.New().String()[:8])
	t.Logf("native-resume negative control: session=%s nonce=%s", sessionID, nonce)

	// Turn 1: create the agent + SQLite state.
	exec1 := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
		"Remember this exact secret token for later: "+nonce+"\nReply with only: ACK",
	)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	_, err := waiter.WaitForPhase(ctx, exec1.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err, "turn 1 should complete")

	// Delete the SDK's SQLite store, then restart — the workspace (and the
	// session's harness_state_id in Mongo) remain, but the local agent record
	// is gone, so Agent.resume() cannot rehydrate.
	stateDir := cursorStateDir(t, sessionID)
	require.DirExists(t, stateDir, "expected SDK state at %s after turn 1", stateDir)
	require.NoError(t, os.RemoveAll(stateDir), "delete SDK state dir")
	t.Logf("deleted Cursor SDK state to simulate restart WITHOUT persisted state: %s", stateDir)

	probe.restart(t, ctx)

	// Turn 2: resume must fail and fall back to a fresh agent.
	exec2 := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
		"What was the secret token I asked you to remember earlier? Reply with ONLY the token.",
	)
	_, err = waiter.WaitForPhase(ctx, exec2.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err, "turn 2 should still complete (via fallback)")

	assertRunnerLogHasResolution(t, probe.logPath(), exec2.GetMetadata().GetId(),
		"created_after_resume_failure")
	t.Logf("RESULT: with the SQLite store deleted, native resume failed and the runner fell back to a fresh agent — confirming native local resume depends on the persisted local SQLite store.")
}

// TestCursorNativeResume_MultipleSessionsOneSandbox covers the workflow-sandbox
// cardinality: one runner/sandbox (one shared workspace volume) hosts MANY agent
// executions, each its own session, because a workflow runs its nested child
// agent calls on the same runner. The Cursor SDK stateRoot is keyed by sessionId
// under the shared volume, so the two sessions must (a) write DISTINCT state
// dirs (no collision) and (b) each resume independently from its own SQLite
// after a restart — recalling its OWN secret, never the other's.
//
// This is the multi-session analogue of SurvivesRestart and the direct guard for
// the "1 sandbox : N sessions" relocation invariant.
//
// Requires CURSOR_API_KEY (skips otherwise).
func TestCursorNativeResume_MultipleSessionsOneSandbox(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 15*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// One probe runner == one sandbox shared by both sessions.
	probe := newResumeProbe(t, ctx)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-multisession-agent",
		"You are a precise assistant with perfect memory of this conversation. "+
			"When asked to remember something, remember it exactly. When later "+
			"asked to recall it, reply with only the requested value.",
	)

	newSession := func() string {
		s := harness.CreateTestSession(t, ctx, clients,
			agent.GetStatus().GetDefaultInstanceId(),
			sessionv1.Harness_HARNESS_CURSOR,
		)
		return s.GetMetadata().GetId()
	}

	sessionA := newSession()
	sessionB := newSession()
	require.NotEqual(t, sessionA, sessionB)
	nonceA := "ALPHA-" + strings.ToUpper(uuid.New().String()[:8])
	nonceB := "BETA-" + strings.ToUpper(uuid.New().String()[:8])
	t.Logf("multi-session probe: A=%s nonceA=%s | B=%s nonceB=%s", sessionA, nonceA, sessionB, nonceB)

	runTurn := func(sessionID, message string) *agentexecv1.AgentExecution {
		exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID, message)
		res, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
			agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
		if err != nil {
			harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
		}
		require.NoError(t, err, "turn should complete for session %s", sessionID)
		require.NotNil(t, res)
		return res
	}

	// --- Turn 1 on each session, in the same sandbox ---
	runTurn(sessionA, "Remember this exact secret token for later: "+nonceA+"\nReply with only: ACK")
	runTurn(sessionB, "Remember this exact secret token for later: "+nonceB+"\nReply with only: ACK")

	// Isolation: two distinct, non-colliding state dirs under the shared volume.
	dirA := cursorStateDir(t, sessionA)
	dirB := cursorStateDir(t, sessionB)
	require.DirExists(t, dirA, "session A SQLite state should exist under the shared workspace volume")
	require.DirExists(t, dirB, "session B SQLite state should exist under the shared workspace volume")
	require.NotEqual(t, dirA, dirB, "the two sessions must use distinct, sessionId-keyed state dirs (no collision)")

	// --- Restart the shared runner (pod restart) with both stores intact ---
	probe.restart(t, ctx)

	// --- Turn 2 on each: each must resume its OWN context, never the other's ---
	res2A := runTurn(sessionA, "What was the secret token I asked you to remember earlier? Reply with ONLY the token.")
	res2B := runTurn(sessionB, "What was the secret token I asked you to remember earlier? Reply with ONLY the token.")

	textA := strings.ToUpper(lastAIMessageText(res2A))
	textB := strings.ToUpper(lastAIMessageText(res2B))
	t.Logf("turn 2 replies: A=%q B=%q", textA, textB)

	assert.Contains(t, textA, nonceA, "session A must recall its own nonce after restart")
	assert.NotContains(t, textA, nonceB, "session A must NOT leak session B's nonce (state isolation)")
	assert.Contains(t, textB, nonceB, "session B must recall its own nonce after restart")
	assert.NotContains(t, textB, nonceA, "session B must NOT leak session A's nonce (state isolation)")
}

// --- helpers -------------------------------------------------------------

// resumeProbe owns a dedicated runner on the shared queue for the duration of a
// test (so the test can read that runner's log and restart it), and restores the
// suite's shared runner on cleanup.
type resumeProbe struct {
	queue   string
	baseCfg harness.UnifiedRunnerConfig
	runner  *harness.UnifiedRunnerStatic
}

// newResumeProbe stops the suite's shared runner and starts a dedicated one on
// the same queue. A cleanup restores the shared runner.
func newResumeProbe(t *testing.T, ctx context.Context) *resumeProbe {
	t.Helper()
	require.NotNil(t, testHarness.UnifiedRunner, "shared unified runner must be available")

	shared := testHarness.UnifiedRunner
	p := &resumeProbe{
		queue:   shared.TaskQueue(),
		baseCfg: shared.Cfg(),
	}

	require.NoError(t, shared.Stop(), "stop shared runner")
	testHarness.UnifiedRunner = nil

	t.Cleanup(func() {
		if p.runner != nil {
			_ = p.runner.Stop()
		}
		// Restore the suite's shared runner so later tests are unaffected.
		restoreCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		restored, err := harness.StartUnifiedRunnerStatic(restoreCtx, p.baseCfg, p.queue, suiteLogger)
		if err != nil {
			t.Logf("WARNING: failed to restore shared unified runner: %v", err)
			return
		}
		testHarness.UnifiedRunner = restored
	})

	p.runner = startProbeRunner(t, ctx, p.baseCfg, p.queue)
	return p
}

// restart stops and re-starts the probe runner on the same queue, leaving the
// workspace volume (and thus the SDK SQLite state) intact — the pod-restart
// simulation.
func (p *resumeProbe) restart(t *testing.T, ctx context.Context) {
	t.Helper()
	require.NoError(t, p.runner.Stop(), "stop probe runner for restart")
	p.runner = startProbeRunner(t, ctx, p.baseCfg, p.queue)
}

func (p *resumeProbe) logPath() string { return p.runner.LogPath() }

func startProbeRunner(t *testing.T, ctx context.Context, cfg harness.UnifiedRunnerConfig, queue string) *harness.UnifiedRunnerStatic {
	t.Helper()
	startCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	r, err := harness.StartUnifiedRunnerStatic(startCtx, cfg, queue, suiteLogger)
	require.NoError(t, err, "start probe unified runner on queue %s", queue)
	return r
}

// cursorStateDir returns the directory where the Cursor SDK persists a
// session's local SQLite stores:
// {WORKSPACE_ROOT_DIR}/.stigmer/cursor-sdk-state/{sessionId}.
// The store now lives on the (durable) workspace volume rather than $HOME, so
// it survives pod restart/reschedule and snapshot restore. The integration
// runner's workspace root is fixed, so this resolves to the same path the
// runner writes to.
func cursorStateDir(t *testing.T, sessionID string) string {
	t.Helper()
	return filepath.Join(harness.UnifiedRunnerWorkspaceDir(), ".stigmer", "cursor-sdk-state", sessionID)
}

// assertRunnerLogHasResolution asserts the runner log contains the
// "ExecuteCursor agent resolved" line for the given execution with the expected
// resolution reason. This is how we distinguish native resume from fallback.
func assertRunnerLogHasResolution(t *testing.T, logPath, executionID, wantReason string) {
	t.Helper()
	data, err := os.ReadFile(logPath)
	require.NoError(t, err, "read runner log at %s", logPath)

	var resolvedLine string
	for _, line := range strings.Split(string(data), "\n") {
		if strings.Contains(line, "ExecuteCursor agent resolved") &&
			strings.Contains(line, "execution="+executionID) {
			resolvedLine = line
			break
		}
	}
	require.NotEmpty(t, resolvedLine,
		"no 'ExecuteCursor agent resolved' log line found for execution=%s in %s",
		executionID, logPath)
	t.Logf("resolution log: %s", strings.TrimSpace(resolvedLine))
	assert.Contains(t, resolvedLine, "reason="+wantReason,
		"expected resolution reason=%s for execution=%s", wantReason, executionID)
}

// lastAIMessageText returns the content of the last MESSAGE_AI in the execution.
func lastAIMessageText(exec *agentexecv1.AgentExecution) string {
	messages := exec.GetStatus().GetMessages()
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].GetType() == agentexecv1.MessageType_MESSAGE_AI {
			return messages[i].GetContent()
		}
	}
	return ""
}

func boolWord(b bool, whenTrue, whenFalse string) string {
	if b {
		return whenTrue
	}
	return whenFalse
}
