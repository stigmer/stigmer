//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sdkSmokeResult is the structured output from TS/Python smoke scripts.
type sdkSmokeResult struct {
	Tier1  string   `json:"tier1"`
	Tier2  string   `json:"tier2"`
	Errors []string `json:"errors"`
}

// ---------------------------------------------------------------------------
// TypeScript SDK Acceptance
// ---------------------------------------------------------------------------

func TestSDKAcceptance_TypeScript(t *testing.T) {
	require.NotNil(t, testHarness, "test harness must be initialized")
	require.NotNil(t, testHarness.Service, "Java service must be running")

	// No skip path: this test silently skipped everywhere for months behind a
	// PATH lookup (oss#481), so missing prerequisites now fail loudly with the
	// command that fixes them (the check-runner-node philosophy).
	tsxBin := requireTsSmokePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	scriptDir := filepath.Join(testdataDir(), "sdk-smoke-ts")

	addr := testHarness.Service.GRPCAddress()
	workflowRunnerAvailable := "false"
	if testHarness.UnifiedRunner != nil {
		workflowRunnerAvailable = "true"
	}

	result, err := runSmokeScript(t, ctx, scriptDir, tsxBin, []string{"smoke.ts"},
		"STIGMER_GRPC_ADDRESS", addr,
		"STIGMER_WORKFLOW_RUNNER_AVAILABLE", workflowRunnerAvailable,
	)

	if err != nil && testHarness.FGAEnabled() && containsFGAError(result) {
		t.Logf("TypeScript smoke test hit FGA conditional tuple limitation (known issue with shared FGA store)")
	} else {
		require.NoError(t, err, "TypeScript smoke script must succeed")
		assert.Equal(t, "pass", result.Tier1, "TypeScript Tier 1 (Agent CRUD) must pass")
		if workflowRunnerAvailable == "true" {
			assert.Equal(t, "pass", result.Tier2, "TypeScript Tier 2 (Workflow Execution) must pass")
		}
		assert.Empty(t, result.Errors, "TypeScript smoke test must produce no errors")
	}
}

// ---------------------------------------------------------------------------
// Python SDK Acceptance
// ---------------------------------------------------------------------------

func TestSDKAcceptance_Python(t *testing.T) {
	require.NotNil(t, testHarness, "test harness must be initialized")
	require.NotNil(t, testHarness.Service, "Java service must be running")

	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not on PATH — skipping Python SDK acceptance test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	scriptDir := filepath.Join(testdataDir(), "sdk-smoke-python")
	requirePythonVenv(t, ctx, scriptDir)

	addr := testHarness.Service.GRPCAddress()
	workflowRunnerAvailable := "false"
	if testHarness.UnifiedRunner != nil {
		workflowRunnerAvailable = "true"
	}

	absScriptDir, err := filepath.Abs(scriptDir)
	require.NoError(t, err, "must resolve absolute script dir")
	venvPython := filepath.Join(absScriptDir, ".venv", "bin", "python3")
	result, err := runSmokeScript(t, ctx, scriptDir, venvPython, []string{"smoke.py"},
		"STIGMER_GRPC_ADDRESS", addr,
		"STIGMER_WORKFLOW_RUNNER_AVAILABLE", workflowRunnerAvailable,
	)

	if err != nil && testHarness.FGAEnabled() && containsFGAError(result) {
		t.Logf("Python smoke test hit FGA conditional tuple limitation (known issue with shared FGA store)")
	} else {
		require.NoError(t, err, "Python smoke script must succeed")
		assert.Equal(t, "pass", result.Tier1, "Python Tier 1 (Agent CRUD) must pass")
		if workflowRunnerAvailable == "true" {
			assert.Equal(t, "pass", result.Tier2, "Python Tier 2 (Workflow Execution) must pass")
		}
		assert.Empty(t, result.Errors, "Python smoke test must produce no errors")
	}
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

func containsFGAError(result sdkSmokeResult) bool {
	for _, e := range result.Errors {
		if strings.Contains(e, "allow_public") || strings.Contains(e, "unauthorized") {
			return true
		}
	}
	return false
}

func testdataDir() string {
	return filepath.Join("testdata")
}

// requireTsSmokePrereqs verifies the TypeScript smoke script can actually run
// and returns the workspace tsx binary to run it with. The smoke's deps are
// provided by the root npm workspace (sdk-smoke-ts is a workspace member), so
// there is deliberately no install-on-demand here: `npm install` inside a
// workspace member directory prunes the root-hoisted packages (the
// test-e2e-approval footgun documented in the root Makefile), and a standalone
// install would fetch the *published* @stigmer/sdk instead of the working tree.
func requireTsSmokePrereqs(t *testing.T) string {
	t.Helper()

	tsxBin, err := harness.ResolveWorkspaceTsx()
	require.NoError(t, err, "TypeScript SDK smoke prerequisites missing")

	repoRoot := harness.MonorepoRoot()

	// The sdk-smoke-ts workspace link only exists when the root install ran
	// against a manifest that lists it as a member — this catches a stale
	// root node_modules from before the smoke joined the workspace, which a
	// tsx-only check would miss.
	smokeLink := filepath.Join(repoRoot, "node_modules", "sdk-smoke-ts")
	if _, err := os.Stat(smokeLink); err != nil {
		require.FailNow(t, "TypeScript SDK smoke deps not installed",
			"workspace link not found at %s — run `npm install` at the repo root", smokeLink)
	}

	// @stigmer/protos exports only dist/ (no dev/src split, unlike
	// @stigmer/sdk), so the smoke needs the stubs built.
	protosDist := filepath.Join(repoRoot, "apis", "stubs", "ts", "dist")
	if _, err := os.Stat(protosDist); err != nil {
		require.FailNow(t, "TypeScript proto stubs not built",
			"dist not found at %s — run `make build-ts-stubs` at the repo root", protosDist)
	}

	return tsxBin
}

// requirePythonVenv creates a virtualenv and installs the stigmer SDK
// plus its proto dependency from local source.
func requirePythonVenv(t *testing.T, ctx context.Context, dir string) {
	t.Helper()

	absDir, err := filepath.Abs(dir)
	require.NoError(t, err, "must resolve absolute script dir")

	venvDir := filepath.Join(absDir, ".venv")

	repoRoot, err := filepath.Abs(filepath.Join(dir, "..", "..", "..", ".."))
	require.NoError(t, err, "must resolve repo root")

	protosDir := filepath.Join(repoRoot, "apis", "stubs", "python", "stigmer")
	sdkDir := filepath.Join(repoRoot, "sdk", "python")

	markerFile := filepath.Join(venvDir, ".sdk-smoke-marker")
	sdkPyproject := filepath.Join(sdkDir, "pyproject.toml")
	needsSetup := true
	if markerInfo, err := os.Stat(markerFile); err == nil {
		if pyInfo, err := os.Stat(sdkPyproject); err == nil {
			needsSetup = pyInfo.ModTime().After(markerInfo.ModTime())
		}
	}

	if !needsSetup {
		return
	}

	t.Log("setting up Python virtualenv for SDK smoke test...")

	cmd := exec.CommandContext(ctx, "python3", "-m", "venv", venvDir)
	cmd.Dir = absDir
	cmd.Stderr = os.Stderr
	require.NoError(t, cmd.Run(), "python3 -m venv must succeed")

	pip := filepath.Join(venvDir, "bin", "pip3")

	cmd = exec.CommandContext(ctx, pip, "install", "--quiet",
		"-r", "requirements.txt",
		"-e", protosDir,
		"-e", sdkDir,
	)
	cmd.Dir = absDir
	cmd.Stderr = os.Stderr
	cmd.Env = append(os.Environ(), "VIRTUAL_ENV="+venvDir)
	require.NoError(t, cmd.Run(), "pip install must succeed")

	require.NoError(t, os.WriteFile(markerFile, []byte("ok"), 0o644))
}

// runSmokeScript executes a smoke test script as a subprocess, captures its
// JSON output from stdout, and returns the parsed result.
// envPairs are key-value pairs added to the subprocess environment.
func runSmokeScript(
	t *testing.T,
	ctx context.Context,
	dir string,
	command string,
	args []string,
	envPairs ...string,
) (sdkSmokeResult, error) {
	t.Helper()

	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = dir

	env := os.Environ()
	for i := 0; i < len(envPairs)-1; i += 2 {
		env = append(env, envPairs[i]+"="+envPairs[i+1])
	}
	cmd.Env = env

	var stdout strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = os.Stderr

	runErr := cmd.Run()

	var result sdkSmokeResult
	if jsonErr := json.Unmarshal([]byte(stdout.String()), &result); jsonErr != nil {
		if runErr != nil {
			return result, fmt.Errorf("smoke script failed (exit: %v) and produced no valid JSON output.\nstdout: %s", runErr, stdout.String())
		}
		return result, fmt.Errorf("smoke script produced invalid JSON output: %v\nstdout: %s", jsonErr, stdout.String())
	}

	if runErr != nil {
		t.Logf("smoke script exited with error: %v", runErr)
		if len(result.Errors) > 0 {
			t.Logf("reported errors: %s", strings.Join(result.Errors, "; "))
		}
	}

	return result, runErr
}
