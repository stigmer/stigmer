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

	if _, err := exec.LookPath("tsx"); err != nil {
		t.Skip("tsx not on PATH — skipping TypeScript SDK acceptance test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	scriptDir := filepath.Join(testdataDir(), "sdk-smoke-ts")
	requireNpmInstall(t, ctx, scriptDir)

	addr := testHarness.Service.GRPCAddress()
	workflowRunnerAvailable := "false"
	if testHarness.UnifiedRunner != nil {
		workflowRunnerAvailable = "true"
	}

	result, err := runSmokeScript(t, ctx, scriptDir, "tsx", []string{"smoke.ts"},
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

// requireNpmInstall runs npm install in the given directory if node_modules
// doesn't exist or package.json is newer.
func requireNpmInstall(t *testing.T, ctx context.Context, dir string) {
	t.Helper()
	nodeModules := filepath.Join(dir, "node_modules")
	pkgJSON := filepath.Join(dir, "package.json")

	needsInstall := true
	if nmInfo, err := os.Stat(nodeModules); err == nil {
		if pkgInfo, err := os.Stat(pkgJSON); err == nil {
			needsInstall = pkgInfo.ModTime().After(nmInfo.ModTime())
		}
	}

	if !needsInstall {
		return
	}

	t.Log("running npm install for TypeScript SDK smoke test...")
	cmd := exec.CommandContext(ctx, "npm", "install", "--no-audit", "--no-fund")
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
	require.NoError(t, cmd.Run(), "npm install must succeed in %s", dir)
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
