//go:build integration

package integration

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

// TestAgentExecution_CursorMcpStdioEnvIsolation is the Cursor-harness twin of
// TestMcpStdio_EnvIsolation_NoDeclaredEnv (mcp_stdio_env_isolation_test.go):
// a stdio MCP subprocess spawned for a Cursor execution must never inherit the
// runner's process environment (oss#388, the #256 leak class through the
// vendor SDK).
//
// Unlike the deep-agent path, the spawn here happens inside @cursor/sdk, not
// in runner-owned code. The static audit of the bundled SDK (v1.0.13; the
// entire local agent runtime ships as JavaScript in node_modules and runs
// in-process in the runner) shows the chain is declared-env-only end to end:
//
//	execute-cursor/mcp-resolver.ts filterEnvToDeclaredKeys(spec.env, envVars)
//	→ toCursorMcpConfig() env: server.env (no process-env fallback)
//	→ SDK McpSdkClient.fromCommand(..., config.env ?? {})
//	→ StdioClientTransport spawn env: {...getDefaultEnvironment(), ...declared}
//
// where getDefaultEnvironment() is the MCP SDK's minimal base (HOME, LOGNAME,
// PATH, SHELL, TERM, USER — Windows equivalents there). This test pins that
// vendor contract empirically, so an SDK upgrade that starts merging the host
// process env into MCP subprocesses fails here instead of shipping a leak.
//
// Attribution — why the report below can only come from the Cursor SDK spawn:
// the Cursor path never uses the runner-side MCP connection manager
// (shared/mcp-manager.ts, per its own header), so runner-owned code cannot
// spawn this server during an execution. The one exception is the connect
// backfill (backfillMcpServersIfNeeded), which runs discovery mid-execution
// for servers with EMPTY discovered capabilities — and discovery spawns
// through the deep-agent path. Connecting the server BEFORE the execution
// populates capabilities (backfill becomes a no-op) and the report file is
// deleted after that connect, so whatever rewrites it during the execution
// window is the SDK's own spawn.
//
// No tool call is requested: the SDK connects and lists tools for every
// configured MCP server while acquiring the local executor inside send()
// (before the first model turn — tools cannot be advertised otherwise), so
// the subprocess starts and writes its report regardless of what the model
// decides to do. That keeps this test free of the LLM tool-choice flakiness
// the MCP image test has to retry around.
//
// Requires CURSOR_API_KEY + CURSOR_ADMIN_KEY (the shared-pool CursorAccount
// seed; one cheap LLM turn — the spawn only happens inside send()). CI: the
// TestAgentExecution_ prefix places this on the providers and agent dispatch
// lanes, which carry the keys; the offline lane skips it.
func TestAgentExecution_CursorMcpStdioEnvIsolation(t *testing.T) {
	harness.RequireCursorPrereqs(t, testHarness)
	if mcpTestServerBinary == "" {
		t.Skip("test MCP server binary not available")
	}

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	reportPath := filepath.Join(t.TempDir(), "env-report.txt")
	server := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary,
		"--env-report", reportPath)

	// Populate discovered capabilities up front so the execution's connect
	// backfill has nothing to do (see attribution note above). Discovery
	// itself spawns the subprocess once, through the deep-agent path.
	harness.ConnectMcpServer(t, ctx, clients, server.GetMetadata().GetId())
	harness.WaitForMcpServerTool(t, ctx, clients,
		server.GetMetadata().GetId(), "echo", 2*time.Minute)

	// Discard the discovery spawn's report: only a report written during the
	// execution window — attributable to the Cursor SDK spawn — counts.
	if err := os.Remove(reportPath); err != nil && !os.IsNotExist(err) {
		t.Fatalf("failed to remove discovery-phase env report: %v", err)
	}

	agent := harness.CreateAgent(t, ctx, clients, "test-cursor-mcp-env-isolation",
		"Reply with the single word DONE. Never call any tools.",
		harness.WithMcpServerUsage(server.GetMetadata().GetSlug()),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), sessionv1.Harness_HARNESS_CURSOR)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Reply with the single word DONE. Do not call any tools.",
		harness.WithAutoApproveAll(true))
	execID := exec.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	if _, err := waiter.WaitForPhase(ctx, execID,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute); err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		require.NoError(t, err, "cursor execution should complete")
	}

	// The SDK spawns MCP servers inside send(), so by completion the report
	// must exist. If it does not, the server never spawned — which would mean
	// the execution ran without its MCP config and the test proved nothing.
	data, err := os.ReadFile(reportPath)
	require.NoError(t, err,
		"no env report after the cursor execution — the stdio MCP server was never "+
			"spawned during the execution window (report at %s)", reportPath)

	present := make(map[string]bool)
	for _, key := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		present[key] = true
	}

	// The MCP SDK's minimal base environment must arrive — PATH is what makes
	// npx/python-style servers resolvable, HOME is what package caches need.
	require.True(t, present["PATH"],
		"subprocess must receive PATH from the MCP SDK base environment; got keys: %v", keysOf(present))
	require.True(t, present["HOME"],
		"subprocess must receive HOME from the MCP SDK base environment; got keys: %v", keysOf(present))

	// Runner-internal credentials must NOT arrive. Same denylist as the
	// deep-agent guard: the harness plants STIGMER_RUNNER_HITL_SECRET and
	// STIGMER_TEST_LEAK_SENTINEL on the runner process (buildUnifiedRunnerEnv)
	// so these assertions hold regardless of which real secrets a given CI
	// environment carries.
	for _, key := range []string{
		"STIGMER_RUNNER_HITL_SECRET",
		"STIGMER_TEST_LEAK_SENTINEL",
		"STIGMER_TOKEN",
		"STIGMER_AUTH_TOKEN",
		"CURSOR_API_KEY",
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
	} {
		require.False(t, present[key],
			"runner credential %q leaked into the Cursor-spawned stdio MCP subprocess environment", key)
	}

	t.Logf("cursor stdio env isolation verified: subprocess saw %d env var(s): %v",
		len(present), keysOf(present))
}
