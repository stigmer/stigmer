//go:build integration

package integration

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

// TestMcpStdio_EnvIsolation_NoDeclaredEnv is the end-to-end guard for
// oss#256: a stdio MCP subprocess must never inherit the runner's process
// environment.
//
// It drives the real spawn path — McpServerCommand.Connect → connect
// workflow → DiscoverMcpServerCapabilities activity → toMcpClientConfig →
// MultiServerMCPClient — with a server that declares no spec.env (the
// exact shape that used to receive the runner's full environment), and
// asserts on an env report the subprocess writes at startup. The report
// carries variable NAMES only, never values, so it is safe in CI logs.
//
// Deliberately discovery-driven rather than agent-execution-driven:
// discovery spawns through the same toMcpClientConfig line, is
// deterministic, and needs no LLM. The report is written before the
// workflow's classification stage runs, so the test does not require
// ANTHROPIC_API_KEY — Connect is fired in the background and only the
// report is awaited (a keyless classifier failing later is irrelevant
// to what the subprocess environment contained).
//
// Beyond guarding against a reintroduced process-env fallback, the PATH
// and HOME assertions pin the upstream contract this fix relies on: the
// MCP SDK merges its minimal base environment (getDefaultEnvironment)
// under whatever the runner passes. If a library upgrade ever changes
// that merge, this test fails.
func TestMcpStdio_EnvIsolation_NoDeclaredEnv(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available — skipping stdio env isolation test")
	}
	if mcpTestServerBinary == "" {
		t.Skip("test MCP server binary not available")
	}

	ctx, cancel := harness.TestContext(t, 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	reportPath := filepath.Join(t.TempDir(), "env-report.txt")
	server := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary,
		"--env-report", reportPath)

	// Fire connect without waiting for the whole workflow: discovery (which
	// spawns the subprocess and produces the report) is stage one; the
	// LLM classification stage that follows may fail in keyless runs and
	// is irrelevant here. Errors are deliberately discarded — if discovery
	// itself never spawns the server, the report poll below fails the test.
	go func() {
		connectCtx, connectCancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer connectCancel()
		_, _ = clients.McpServerCommand.Connect(connectCtx, &mcpserverv1.ConnectInput{
			McpServerId: server.GetMetadata().GetId(),
			Org:         harness.TestOrg,
		})
	}()

	var report string
	require.Eventually(t, func() bool {
		data, err := os.ReadFile(reportPath)
		if err != nil {
			return false
		}
		report = string(data)
		return true
	}, 90*time.Second, 500*time.Millisecond,
		"discovery never spawned the stdio MCP server (no env report at %s)", reportPath)

	present := make(map[string]bool)
	for _, key := range strings.Split(strings.TrimSpace(report), "\n") {
		present[key] = true
	}

	// The MCP SDK's minimal base environment must arrive — PATH is what makes
	// npx/python-style servers resolvable, HOME is what package caches need.
	require.True(t, present["PATH"],
		"subprocess must receive PATH from the MCP SDK base environment; got keys: %v", keysOf(present))
	require.True(t, present["HOME"],
		"subprocess must receive HOME from the MCP SDK base environment; got keys: %v", keysOf(present))

	// Runner-internal credentials must NOT arrive. The harness plants
	// STIGMER_RUNNER_HITL_SECRET and STIGMER_TEST_LEAK_SENTINEL on the
	// runner process (buildUnifiedRunnerEnv) so these assertions hold
	// regardless of which real secrets a given CI environment carries.
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
			"runner credential %q leaked into the stdio MCP subprocess environment", key)
	}

	t.Logf("stdio env isolation verified: subprocess saw %d env var(s)", len(present))
}

func keysOf(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
