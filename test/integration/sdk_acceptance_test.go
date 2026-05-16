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

	stigmer "github.com/stigmer/stigmer/sdk/go"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
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
// Go SDK Acceptance
// ---------------------------------------------------------------------------

func TestSDKAcceptance_Go(t *testing.T) {
	require.NotNil(t, testHarness, "test harness must be initialized")
	require.NotNil(t, testHarness.Service, "Java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	addr := testHarness.Service.GRPCAddress()
	client, err := stigmer.NewClient(
		stigmer.WithBaseURL(addr),
		stigmer.WithInsecure(),
	)
	require.NoError(t, err, "SDK client creation must succeed")
	defer client.Close()

	require.NoError(t, client.Connect(ctx), "SDK client must connect to the server")

	testName := strings.ReplaceAll(t.Name(), "/", "-")

	// -- Tier 1: Agent CRUD + error handling --

	t.Run("Tier1_AgentCRUD", func(t *testing.T) {
		agentName := fmt.Sprintf("sdk-smoke-go-%s", testName)

		// Create
		created, err := client.Agent.Apply(ctx, &stigmer.AgentInput{
			Name:         agentName,
			Org:          "test-org",
			Description:  "SDK acceptance smoke test agent (Go)",
			Instructions: "You are a test agent. Respond with exactly: hello from sdk smoke test",
		})
		require.NoError(t, err, "Agent.Apply must succeed")
		require.NotEmpty(t, created.GetMetadata().GetId(), "created agent must have an ID")
		agentID := created.GetMetadata().GetId()
		t.Logf("created agent: id=%s, name=%s", agentID, created.GetMetadata().GetName())

		// Get
		fetched, err := client.Agent.Get(ctx, agentID)
		require.NoError(t, err, "Agent.Get must succeed")
		assert.Equal(t, agentName, fetched.GetMetadata().GetName(), "agent name must match")
		assert.Equal(t, "test-org", fetched.GetMetadata().GetOrg(), "agent org must match")
		assert.Equal(t, "SDK acceptance smoke test agent (Go)", fetched.GetSpec().GetDescription(), "agent description must match")

		// List
		listResult, err := client.Agent.List(ctx, &stigmer.ListParams{Org: "test-org"})
		require.NoError(t, err, "Agent.List must succeed")
		require.Greater(t, listResult.TotalCount, int32(0), "agent list must contain at least one entry")

		// Delete
		_, err = client.Agent.Delete(ctx, agentID)
		require.NoError(t, err, "Agent.Delete must succeed")

		// Get deleted -> NOT_FOUND
		_, err = client.Agent.Get(ctx, agentID)
		require.Error(t, err, "Agent.Get on deleted agent must return an error")
		assert.True(t, stigmer.IsNotFound(err), "error must be NOT_FOUND, got: %v", err)
	})

	// -- Tier 2: Workflow execution lifecycle --

	t.Run("Tier2_WorkflowExecution", func(t *testing.T) {
		if testHarness.WorkflowRunner == nil {
			t.Skip("workflow-runner not available — skipping workflow execution test")
		}

		workflowName := fmt.Sprintf("sdk-smoke-wf-go-%s", testName)

		// Apply workflow with a single set_vars task
		applied, err := client.Workflow.Apply(ctx, &stigmer.WorkflowInput{
			Name: workflowName,
			Org:  "test-org",
			Document: &stigmer.WorkflowDocumentInput{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      workflowName,
				Version:   "1.0.0",
			},
			Tasks: []*stigmer.WorkflowTaskInput{
				{
					Name: "setGreeting",
					Kind: workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: map[string]any{
						"variables": map[string]any{
							"greeting": "hello-from-go-sdk-smoke-test",
						},
					},
					Export: &stigmer.ExportInput{As: "${.}"},
				},
			},
		})
		require.NoError(t, err, "Workflow.Apply must succeed")
		workflowID := applied.GetMetadata().GetId()
		t.Logf("applied workflow: id=%s", workflowID)

		// Create execution
		execution, err := client.WorkflowExecution.Create(ctx, &stigmer.WorkflowExecutionInput{
			Name:           fmt.Sprintf("sdk-smoke-exec-go-%s", testName),
			Org:            "test-org",
			WorkflowId:     workflowID,
			TriggerMessage: "SDK acceptance smoke test",
		})
		require.NoError(t, err, "WorkflowExecution.Create must succeed")
		executionID := execution.GetMetadata().GetId()
		t.Logf("created execution: id=%s", executionID)

		// Poll until COMPLETED or timeout
		pollCtx, pollCancel := context.WithTimeout(ctx, 90*time.Second)
		defer pollCancel()

		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		var result *workflowexecutionv1.WorkflowExecution
		for {
			select {
			case <-pollCtx.Done():
				t.Fatalf("timed out waiting for execution to complete; last phase: %s",
					result.GetStatus().GetPhase().String())
			case <-ticker.C:
				result, err = client.WorkflowExecution.Get(ctx, executionID)
				require.NoError(t, err, "WorkflowExecution.Get must succeed during polling")

				phase := result.GetStatus().GetPhase()
				if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
					t.Logf("execution completed: id=%s", executionID)
					goto done
				}
				if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
					phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED {
					t.Fatalf("execution reached terminal failure phase: %s", phase.String())
				}
			}
		}
	done:
		assert.Equal(t,
			workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			result.GetStatus().GetPhase(),
			"execution must reach COMPLETED phase",
		)

		// Verify task status
		for _, task := range result.GetStatus().GetTasks() {
			if task.GetTaskName() == "setGreeting" {
				assert.Equal(t,
					workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
					task.GetStatus(),
					"setGreeting task must be COMPLETED",
				)
			}
		}

		// Cleanup
		_, err = client.Workflow.Delete(ctx, workflowID)
		assert.NoError(t, err, "workflow cleanup deletion should succeed")
	})
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
	if testHarness.WorkflowRunner != nil {
		workflowRunnerAvailable = "true"
	}

	result := runSmokeScript(t, ctx, scriptDir, "tsx", []string{"smoke.ts"},
		"STIGMER_GRPC_ADDRESS", addr,
		"STIGMER_WORKFLOW_RUNNER_AVAILABLE", workflowRunnerAvailable,
	)

	assert.Equal(t, "pass", result.Tier1, "TypeScript Tier 1 (Agent CRUD) must pass")
	if workflowRunnerAvailable == "true" {
		assert.Equal(t, "pass", result.Tier2, "TypeScript Tier 2 (Workflow Execution) must pass")
	}
	assert.Empty(t, result.Errors, "TypeScript smoke test must produce no errors")
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
	if testHarness.WorkflowRunner != nil {
		workflowRunnerAvailable = "true"
	}

	venvPython := filepath.Join(scriptDir, ".venv", "bin", "python3")
	result := runSmokeScript(t, ctx, scriptDir, venvPython, []string{"smoke.py"},
		"STIGMER_GRPC_ADDRESS", addr,
		"STIGMER_WORKFLOW_RUNNER_AVAILABLE", workflowRunnerAvailable,
	)

	assert.Equal(t, "pass", result.Tier1, "Python Tier 1 (Agent CRUD) must pass")
	if workflowRunnerAvailable == "true" {
		assert.Equal(t, "pass", result.Tier2, "Python Tier 2 (Workflow Execution) must pass")
	}
	assert.Empty(t, result.Errors, "Python smoke test must produce no errors")
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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
	venvDir := filepath.Join(dir, ".venv")

	// Resolve repo root (test/integration/testdata/sdk-smoke-python -> repo root)
	repoRoot, err := filepath.Abs(filepath.Join(dir, "..", "..", "..", ".."))
	require.NoError(t, err, "must resolve repo root")

	protosDir := filepath.Join(repoRoot, "apis", "stubs", "python", "stigmer")
	sdkDir := filepath.Join(repoRoot, "sdk", "python")

	// Use the SDK's pyproject.toml mtime as the freshness signal.
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
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
	require.NoError(t, cmd.Run(), "python3 -m venv must succeed")

	pip := filepath.Join(venvDir, "bin", "pip3")

	// Install base deps + protos + SDK from local source in dependency order.
	cmd = exec.CommandContext(ctx, pip, "install", "--quiet",
		"-r", "requirements.txt",
		"-e", protosDir,
		"-e", sdkDir,
	)
	cmd.Dir = dir
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
) sdkSmokeResult {
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

	err := cmd.Run()

	// Parse JSON output regardless of exit code — the script may have
	// written partial results before failing.
	var result sdkSmokeResult
	if jsonErr := json.Unmarshal([]byte(stdout.String()), &result); jsonErr != nil {
		if err != nil {
			t.Fatalf("smoke script failed (exit: %v) and produced no valid JSON output.\nstdout: %s", err, stdout.String())
		}
		t.Fatalf("smoke script produced invalid JSON output: %v\nstdout: %s", jsonErr, stdout.String())
	}

	if err != nil {
		t.Logf("smoke script exited with error: %v", err)
		if len(result.Errors) > 0 {
			t.Logf("reported errors: %s", strings.Join(result.Errors, "; "))
		}
		t.Fatalf("smoke script failed: %v", err)
	}

	return result
}
