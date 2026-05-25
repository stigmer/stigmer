//go:build integration

package integration

import (
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflow_StructuredOutput validates structured output propagation at the workflow level.
// These tests verify that agent_call tasks with output.schema produce structured data that
// flows correctly through the pipeline to downstream tasks via $context.
//
// Philosophy: DISCOVER issues in the full pipeline, not fix them.
func TestWorkflow_StructuredOutput(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available — skipping workflow structured output tests")
	}

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 10*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			deployer := harness.NewFixtureDeployer(clients, "structured-output-"+h.Name, nil)
			defer deployer.Cleanup(ctx)

			wfWaiter := harness.NewExecutionWaiter(clients.ExecutionQuery, nil)

			// Create an agent for agent_call tasks
			agent := harness.CreateAgent(t, ctx, clients, "test-wf-so-"+h.Name,
				"You are a test assistant. When asked to produce structured data, "+
					"respond with ONLY the JSON object, nothing else.")

			// --- EndToEnd: agent_call with schema → extraction → task output ---

			t.Run("AgentCallWithSchema", func(t *testing.T) {
				// Build a workflow with a single agent_call that defines output.schema
				wf := buildStructuredOutputWorkflow(t, "so-basic-"+h.Name, agent.GetMetadata().GetSlug(), h.Name)

				_, exec, err := deployer.DeployAndExecute(ctx, wf,
					"Analyze user engagement. Produce a summary and score.")
				require.NoError(t, err)

				completed, err := wfWaiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 8*time.Minute)
				require.NoError(t, err)

				phase := completed.GetStatus().GetPhase()
				t.Logf("Workflow phase: %s", phase)

				for _, task := range completed.GetStatus().GetTasks() {
					logTaskSummary(t, task)
				}

				if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
					// Find the agent_call task and check its output
					for _, task := range completed.GetStatus().GetTasks() {
						if task.GetTaskType() == workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_AGENT_INVOCATION {
							output := task.GetOutput()
							if output == nil {
								t.Log("[C3/C5] Agent task completed but output is nil — data lost in callback transit.")
							} else {
								_, hasStructured := output.GetFields()["structured"]
								if !hasStructured {
									t.Log("[C3] Task output missing 'structured' key — callback key mismatch.")
								} else {
									t.Log("Task output has 'structured' key — pipeline working.")
								}
							}
						}
					}
				} else if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED {
					errorMsg := completed.GetStatus().GetError()
					t.Logf("Workflow FAILED: %s", errorMsg)
					if containsStructuredOutputError(errorMsg) {
						t.Log("[STRUCTURED OUTPUT FAILURE] Workflow failed due to structured output pipeline issue.")
					}
				}
			})

			// --- Schema propagation through agent_call config ---

			t.Run("SchemaReachesChildExecution", func(t *testing.T) {
				// Targets: A1 — verify schema is persisted on the child AgentExecution
				wf := buildStructuredOutputWorkflow(t, "so-schema-check-"+h.Name, agent.GetMetadata().GetSlug(), h.Name)

				_, exec, err := deployer.DeployAndExecute(ctx, wf,
					"Quick test for schema propagation.")
				require.NoError(t, err)

				completed, err := wfWaiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 8*time.Minute)
				require.NoError(t, err)

				// Find child agent execution ID from task metadata
				for _, task := range completed.GetStatus().GetTasks() {
					if task.GetTaskType() == workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_AGENT_INVOCATION {
						meta := task.GetMetadata()
						if meta != nil {
							aexIDVal := meta.GetFields()["agent_execution_id"]
							if aexIDVal != nil {
								aexID := aexIDVal.GetStringValue()
								t.Logf("Child agent execution ID: %s", aexID)

								// Fetch the child execution and check its schema
								childExec, err := clients.AgentExecutionQuery.Get(ctx,
									&agentexecv1.AgentExecutionId{Value: aexID})
								if err != nil {
									t.Logf("Could not fetch child execution: %v", err)
									continue
								}
								harness.AssertExecutionHasSchema(t, childExec)

								so := childExec.GetStatus().GetStructuredOutput()
								if so != nil {
									t.Logf("Child execution structuredOutput: %v", harness.StructKeys(so))
								} else {
									t.Log("Child execution structuredOutput is nil.")
								}
							}
						}
					}
				}
			})
		})
	}
}

// TestWorkflow_StructuredOutput_FailureDetection tests workflow-level failure scenarios
// for structured output issues.
func TestWorkflow_StructuredOutput_FailureDetection(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 10*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			deployer := harness.NewFixtureDeployer(clients, "so-fail-"+h.Name, nil)
			defer deployer.Cleanup(ctx)

			wfWaiter := harness.NewExecutionWaiter(clients.ExecutionQuery, nil)

			agent := harness.CreateAgent(t, ctx, clients, "test-wf-so-fail-"+h.Name,
				"You are a test assistant. Follow instructions precisely.")

			t.Run("OnInvalidFail_MissingStructured", func(t *testing.T) {
				// Schema requires fields the agent won't produce → workflow should FAIL
				wf := buildStrictSchemaWorkflow(t, "so-strict-"+h.Name, agent.GetMetadata().GetSlug(), h.Name)

				_, exec, err := deployer.DeployAndExecute(ctx, wf,
					"Write a poem about clouds. Do NOT include any JSON.")
				require.NoError(t, err)

				completed, err := wfWaiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 8*time.Minute)
				require.NoError(t, err)

				phase := completed.GetStatus().GetPhase()
				t.Logf("Workflow phase: %s, error: %s", phase, completed.GetStatus().GetError())

				// With on_invalid: fail, the workflow should fail when structured output is missing
				if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED {
					t.Log("Correct: workflow failed when agent couldn't produce structured output.")
				} else if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
					t.Log("[D1 POSSIBLE] Workflow completed despite agent not following schema — " +
						"validation may be too permissive or extraction produced data from nothing.")
				}
			})

			t.Run("ErrorMessageQuality", func(t *testing.T) {
				// When structured output fails, is the error message actionable?
				wf := buildStrictSchemaWorkflow(t, "so-errmsg-"+h.Name, agent.GetMetadata().GetSlug(), h.Name)

				_, exec, err := deployer.DeployAndExecute(ctx, wf,
					"Tell me a joke. No JSON.")
				require.NoError(t, err)

				completed, err := wfWaiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 8*time.Minute)
				require.NoError(t, err)

				if completed.GetStatus().GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED {
					msg := completed.GetStatus().GetError()
					if containsStructuredOutputError(msg) {
						keywords := []string{"expected", "required", "missing", "failed to extract", "schema"}
						found := false
						for _, kw := range keywords {
							if strings.Contains(strings.ToLower(msg), kw) {
								found = true
								break
							}
						}
						if found {
							t.Log("Error message is actionable — mentions structured output with context.")
						} else {
							t.Log("[ERROR QUALITY] Error mentions structured output but is not actionable.")
						}
					}
					t.Logf("Full error: %s", msg)
				}
			})
		})
	}
}

// --- Workflow builders ---

func buildStructuredOutputWorkflow(t *testing.T, name, agentSlug, harnessName string) *workflowv1.Workflow {
	t.Helper()
	schema := harness.SummaryScoreSchema(t)
	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agentSlug,
		"org":     "test-org",
		"message": "$trigger",
		"output": map[string]any{
			"schema":     schema.AsMap(),
			"on_invalid": "ON_INVALID_FAIL",
		},
	})
	require.NoError(t, err)

	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "analyze",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}
}

func buildStrictSchemaWorkflow(t *testing.T, name, agentSlug, harnessName string) *workflowv1.Workflow {
	t.Helper()
	schema := harness.SummaryScoreSchema(t)
	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agentSlug,
		"org":     "test-org",
		"message": "$trigger",
		"output": map[string]any{
			"schema":     schema.AsMap(),
			"on_invalid": "ON_INVALID_FAIL",
		},
	})
	require.NoError(t, err)

	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "strict_analyze",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}
}

func logTaskSummary(t *testing.T, task *workflowexecutionv1.WorkflowTask) {
	t.Helper()
	t.Logf("  Task %q (%s): status=%s", task.GetTaskName(), task.GetTaskType(), task.GetStatus())
	if task.GetOutput() != nil {
		t.Logf("    Output keys: %v", harness.StructKeys(task.GetOutput()))
	}
	if task.GetError() != "" {
		t.Logf("    Error: %s", task.GetError())
	}
}

func containsStructuredOutputError(msg string) bool {
	keywords := []string{
		"structured output", "structuredOutput", "structured_output",
		"did not return structured", "schema", "extraction", "on_invalid",
	}
	lower := strings.ToLower(msg)
	for _, kw := range keywords {
		if strings.Contains(lower, strings.ToLower(kw)) {
			return true
		}
	}
	return false
}
