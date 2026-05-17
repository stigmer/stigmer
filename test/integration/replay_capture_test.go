//go:build integration

package integration

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestCaptureReplayHistories runs representative workflows and exports their
// Temporal event histories as JSON files for use in replay determinism tests.
//
// This test is gated behind the CAPTURE_REPLAY_HISTORIES env var so it does
// not run during normal `make test-integration`. Use the dedicated target:
//
//	make capture-replay-histories
//
// The exported histories are gold masters: they are committed to the repo at
// backend/services/workflow-runner/test/replay/testdata/replay-histories/
// and replayed on every PR that touches the workflow-runner code.
func TestCaptureReplayHistories(t *testing.T) {
	if os.Getenv("CAPTURE_REPLAY_HISTORIES") == "" {
		t.Skip("set CAPTURE_REPLAY_HISTORIES=1 to run (or use: make capture-replay-histories)")
	}

	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	require.NotNil(t, testHarness.WorkflowRunner, "workflow-runner must be running")

	outputDir := os.Getenv("REPLAY_HISTORY_OUTPUT_DIR")
	if outputDir == "" {
		outputDir = filepath.Join(".test-output", "replay-histories")
	}

	temporalClient, err := harness.NewTemporalClient(testHarness.Temporal.Address())
	require.NoError(t, err, "connect to Temporal for history export")
	defer temporalClient.Close()

	exporter := harness.NewHistoryExporter(temporalClient, outputDir)

	type captureCase struct {
		name     string
		workflow func(t *testing.T) *workflowv1.Workflow
		terminal workflowexecutionv1.ExecutionPhase
	}

	cases := []captureCase{
		{
			name:     "set_vars",
			workflow: captureWorkflow_SetVars,
			terminal: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		},
		{
			name:     "set_vars_chain",
			workflow: captureWorkflow_SetVarsChain,
			terminal: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		},
		{
			name:     "transform",
			workflow: captureWorkflow_Transform,
			terminal: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		},
		{
			name:     "switch_case",
			workflow: captureWorkflow_SwitchCase,
			terminal: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		},
		{
			name:     "try_catch",
			workflow: captureWorkflow_TryCatch,
			terminal: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		},
		{
			name:     "raise_error",
			workflow: captureWorkflow_RaiseError,
			terminal: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		},
		{
			name:     "http_call",
			workflow: captureWorkflow_HTTPCall,
			terminal: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		},
		{
			name:     "for_each",
			workflow: captureWorkflow_ForEach,
			terminal: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			deployer := harness.NewFixtureDeployer(clients, fmt.Sprintf("replay-%s", tc.name), suiteLogger)
			defer deployer.Cleanup(ctx)

			wf := tc.workflow(t)
			_, execution, err := deployer.DeployAndExecute(ctx, wf, "replay history capture")
			require.NoError(t, err, "deploy and execute should succeed")

			executionID := execution.GetMetadata().GetId()
			require.NotEmpty(t, executionID)

			waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
			_, err = waiter.WaitForPhase(ctx, executionID, tc.terminal, 90*time.Second)
			require.NoError(t, err, "execution should reach terminal phase %s", tc.terminal)

			filename := fmt.Sprintf("%s.json", tc.name)
			err = exporter.ExportByExecutionID(ctx, executionID, filename)
			require.NoError(t, err, "export history for %s", tc.name)

			t.Logf("exported history: %s/%s", outputDir, filename)
		})
	}
}

func captureWorkflow_SetVars(t *testing.T) *workflowv1.Workflow {
	cfg := mustStruct(t, map[string]any{
		"variables": map[string]any{
			"greeting": "hello-from-replay-capture",
		},
	})
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "replay-capture-set-vars", Org: "test-org"},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Replay capture: single set_vars",
			Document:    &workflowv1.WorkflowDocument{Dsl: "1.0.0", Namespace: "test-org", Name: "replay-capture-set-vars", Version: "1.0.0"},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "setGreeting", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: cfg, Export: &workflowv1.Export{As: "${.}"}},
			},
		},
	}
}

func captureWorkflow_SetVarsChain(t *testing.T) *workflowv1.Workflow {
	cfg1 := mustStruct(t, map[string]any{"variables": map[string]any{"step": "one"}})
	cfg2 := mustStruct(t, map[string]any{"variables": map[string]any{"step": "two"}})
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "replay-capture-set-chain", Org: "test-org"},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Replay capture: chained set_vars",
			Document:    &workflowv1.WorkflowDocument{Dsl: "1.0.0", Namespace: "test-org", Name: "replay-capture-set-chain", Version: "1.0.0"},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "stepOne", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: cfg1, Export: &workflowv1.Export{As: "${.}"}},
				{Name: "stepTwo", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: cfg2, Export: &workflowv1.Export{As: "${.}"}},
			},
		},
	}
}

func captureWorkflow_Transform(t *testing.T) *workflowv1.Workflow {
	setCfg := mustStruct(t, map[string]any{"variables": map[string]any{"first_name": "Ada", "last_name": "Lovelace"}})
	transformCfg := mustStruct(t, map[string]any{
		"engine":     "TRANSFORM_ENGINE_JQ",
		"expression": `{full_name: (.first_name + " " + .last_name)}`,
	})
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "replay-capture-transform", Org: "test-org"},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Replay capture: transform with JQ",
			Document:    &workflowv1.WorkflowDocument{Dsl: "1.0.0", Namespace: "test-org", Name: "replay-capture-transform", Version: "1.0.0"},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "initData", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: setCfg, Export: &workflowv1.Export{As: "${.}"}},
				{Name: "transformData", Kind: workflowv1.WorkflowTaskKind_transform, TaskConfig: transformCfg, Export: &workflowv1.Export{As: "${.}"}},
			},
		},
	}
}

func captureWorkflow_SwitchCase(t *testing.T) *workflowv1.Workflow {
	initCfg := mustStruct(t, map[string]any{"variables": map[string]any{"severity": "critical"}})
	switchCfg := mustStruct(t, map[string]any{
		"cases": []any{
			map[string]any{"name": "critical", "when": `${ $data.severity == "critical" }`, "then": "handleCritical"},
			map[string]any{"name": "default", "then": "handleDefault"},
		},
	})
	criticalCfg := mustStruct(t, map[string]any{"variables": map[string]any{"result": "escalated"}})
	defaultCfg := mustStruct(t, map[string]any{"variables": map[string]any{"result": "logged"}})
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "replay-capture-switch", Org: "test-org"},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Replay capture: switch_case branching",
			Document:    &workflowv1.WorkflowDocument{Dsl: "1.0.0", Namespace: "test-org", Name: "replay-capture-switch", Version: "1.0.0"},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "initVars", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: initCfg, Export: &workflowv1.Export{As: "${.}"}},
				{Name: "routeBySeverity", Kind: workflowv1.WorkflowTaskKind_switch_case, TaskConfig: switchCfg},
				{Name: "handleCritical", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: criticalCfg, Flow: &workflowv1.FlowControl{Then: "end"}},
				{Name: "handleDefault", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: defaultCfg, Flow: &workflowv1.FlowControl{Then: "end"}},
			},
		},
	}
}

func captureWorkflow_TryCatch(t *testing.T) *workflowv1.Workflow {
	tryCatchCfg := mustStruct(t, map[string]any{
		"try": []any{
			map[string]any{
				"name": "failStep",
				"kind": "raise_error",
				"task_config": map[string]any{
					"error":   "TestError",
					"message": "deliberate for replay",
				},
			},
		},
		"catch": map[string]any{
			"as": "error",
			"do": []any{
				map[string]any{
					"name": "recover",
					"kind": "set_vars",
					"task_config": map[string]any{
						"variables": map[string]any{"recovered": "true"},
					},
				},
			},
		},
	})
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "replay-capture-try-catch", Org: "test-org"},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Replay capture: try/catch error handling",
			Document:    &workflowv1.WorkflowDocument{Dsl: "1.0.0", Namespace: "test-org", Name: "replay-capture-try-catch", Version: "1.0.0"},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "safeOperation", Kind: workflowv1.WorkflowTaskKind_try_catch, TaskConfig: tryCatchCfg},
			},
		},
	}
}

func captureWorkflow_RaiseError(t *testing.T) *workflowv1.Workflow {
	raiseCfg := mustStruct(t, map[string]any{"error": "ValidationError", "message": "deliberate for replay"})
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "replay-capture-raise-error", Org: "test-org"},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Replay capture: raise_error → FAILED",
			Document:    &workflowv1.WorkflowDocument{Dsl: "1.0.0", Namespace: "test-org", Name: "replay-capture-raise-error", Version: "1.0.0"},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "failDeliberately", Kind: workflowv1.WorkflowTaskKind_raise_error, TaskConfig: raiseCfg},
			},
		},
	}
}

func captureWorkflow_HTTPCall(t *testing.T) *workflowv1.Workflow {
	mock := harness.NewMockHTTPServer([]harness.MockRoute{
		{Method: "GET", Path: "/api/replay-data", StatusCode: 200, Response: map[string]any{"status": "ok"}},
	})
	t.Cleanup(mock.Close)

	setCfg := mustStruct(t, map[string]any{"variables": map[string]any{"mock_url": mock.URL() + "/api/replay-data"}})
	httpCfg := mustStruct(t, map[string]any{
		"method":          "GET",
		"endpoint":        map[string]any{"uri": "${ $data.mock_url }"},
		"timeout_seconds": float64(30),
	})
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "replay-capture-http", Org: "test-org"},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Replay capture: http_call with mock server",
			Document:    &workflowv1.WorkflowDocument{Dsl: "1.0.0", Namespace: "test-org", Name: "replay-capture-http", Version: "1.0.0"},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "setURL", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: setCfg, Export: &workflowv1.Export{As: "${.}"}},
				{Name: "fetchData", Kind: workflowv1.WorkflowTaskKind_http_call, TaskConfig: httpCfg},
			},
		},
	}
}

func captureWorkflow_ForEach(t *testing.T) *workflowv1.Workflow {
	initCfg := mustStruct(t, map[string]any{"variables": map[string]any{"count": "3"}})
	forCfg := mustStruct(t, map[string]any{
		"in":   "${ 3 }",
		"each": "item",
		"do": []any{
			map[string]any{
				"name": "step",
				"kind": "set_vars",
				"task_config": map[string]any{
					"variables": map[string]any{"iteration": "done"},
				},
			},
		},
	})
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "replay-capture-for-each", Org: "test-org"},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Replay capture: for_each iteration",
			Document:    &workflowv1.WorkflowDocument{Dsl: "1.0.0", Namespace: "test-org", Name: "replay-capture-for-each", Version: "1.0.0"},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "initData", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: initCfg, Export: &workflowv1.Export{As: "${.}"}},
				{Name: "iterate", Kind: workflowv1.WorkflowTaskKind_for_each, TaskConfig: forCfg},
			},
		},
	}
}

func mustStruct(t *testing.T, m map[string]any) *structpb.Struct {
	t.Helper()
	s, err := structpb.NewStruct(m)
	require.NoError(t, err)
	return s
}
