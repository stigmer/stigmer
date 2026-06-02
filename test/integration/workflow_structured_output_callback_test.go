//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflow_StructuredOutput_CallbackHandoff is a hard regression test
// for the structured output callback pipeline. It asserts the full chain:
//
//  1. Runner extracts structured output and persists it (AgentExecution.status.structuredOutput)
//  2. Java/Go callback builder includes "structured" in the async completion payload
//  3. TS workflow engine receives result.structured and validation passes
//  4. Workflow completes with structured data in task output
//
// This test was created to reproduce a production failure where:
// - Runner logs hasStructuredOutput=true
// - MongoDB has structuredOutput populated
// - But workflow fails with "Agent did not return structured output"
//
// Root cause: Java's buildCallbackResultJson reads from the deserialized
// activity proto (finalStatus.hasStructuredOutput()) which can fail when
// google.protobuf.Struct serialization diverges between TS and Java.
// The Go OSS path has a DB fallback; Java did not.
func TestWorkflow_StructuredOutput_CallbackHandoff(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available — skipping structured output callback test")
	}

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 10*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			deployer := harness.NewFixtureDeployer(clients, "so-callback-"+h.Name, nil)
			defer deployer.Cleanup(ctx)

			wfWaiter := harness.NewExecutionWaiter(clients.ExecutionQuery, nil)

			agent := harness.CreateAgent(t, ctx, clients, "test-so-callback-"+h.Name,
				"You are a data analyst. When asked to analyze data, respond with ONLY "+
					"a JSON object matching the requested schema. No markdown, no explanation, "+
					"no code fences. Just the raw JSON object.")

			t.Run("EndToEnd_AgentExtraction_To_WorkflowTaskOutput", func(t *testing.T) {
				schema := harness.SummaryScoreSchema(t)
				harnessStr := ""
				if h.Name == "cursor" {
					harnessStr = "cursor"
				}

				wf := buildCallbackHandoffWorkflow(t,
					"so-cb-e2e-"+h.Name,
					agent.GetMetadata().GetSlug(),
					harnessStr,
					schema,
				)

				_, exec, err := deployer.DeployAndExecute(ctx, wf,
					"Analyze user engagement for a mobile app. "+
						"Respond with ONLY a JSON object like: "+
						`{"summary": "User engagement is strong with 85% DAU retention", "score": 8}`)
				require.NoError(t, err)

				executionID := exec.GetMetadata().GetId()
				t.Logf("Workflow execution created: id=%s", executionID)

				completed, err := wfWaiter.WaitForTerminal(ctx, executionID, 8*time.Minute)
				require.NoError(t, err)

				phase := completed.GetStatus().GetPhase()
				t.Logf("Workflow phase: %s", phase)

				if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED {
					t.Logf("Workflow FAILED with error: %s", completed.GetStatus().GetError())
				}

				// Find and inspect the child agent execution
				childExec := findChildForCallbackTest(t, ctx, clients, executionID)
				if childExec != nil {
					t.Logf("Child agent execution: id=%s, phase=%s",
						childExec.GetMetadata().GetId(),
						childExec.GetStatus().GetPhase())

					// Assert: child has structuredOutput populated (runner extraction worked)
					harness.AssertStructuredOutputPopulated(t, childExec)
					harness.AssertStructuredOutputHasKeys(t, childExec, "summary", "score")
				}

				// HARD ASSERTION: workflow must complete (not fail with structured output error)
				require.Equal(t, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, phase,
					"Workflow must complete when agent returns valid structured output. "+
						"If FAILED, the callback pipeline lost structured data in transit. "+
						"Error: %s", completed.GetStatus().GetError())

				// Assert: workflow task output contains "structured" key
				for _, task := range completed.GetStatus().GetTasks() {
					if task.GetTaskType() == workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_AGENT_INVOCATION {
						output := task.GetOutput()
						require.NotNil(t, output,
							"[C5] Agent task output must not be nil — callback data lost in transit")

						structuredVal, hasStructured := output.GetFields()["structured"]
						require.True(t, hasStructured,
							"[C3] Task output missing 'structured' key — "+
								"buildCallbackResultJson omitted structuredOutput from payload")

						structObj := structuredVal.GetStructValue()
						require.NotNil(t, structObj,
							"structured value should be an object, got: %v", structuredVal)

						// Verify schema-required fields are present
						_, hasSummary := structObj.GetFields()["summary"]
						_, hasScore := structObj.GetFields()["score"]
						assert.True(t, hasSummary, "structured output missing 'summary' field")
						assert.True(t, hasScore, "structured output missing 'score' field")

						t.Logf("Callback handoff SUCCESS: structured output keys=%v",
							harness.StructKeys(structObj))
					}
				}
			})
		})
	}
}

func buildCallbackHandoffWorkflow(
	t *testing.T,
	name, agentSlug, harnessName string,
	schema *structpb.Struct,
) *workflowv1.Workflow {
	t.Helper()

	taskConfigMap := map[string]any{
		"agent":   agentSlug,
		"org":     harness.TestOrg,
		"message": "$trigger",
		"output": map[string]any{
			"schema":     schema.AsMap(),
			"on_invalid": "ON_INVALID_FAIL",
		},
	}
	if harnessName != "" {
		taskConfigMap["harness"] = harnessName
	}

	taskConfig, err := structpb.NewStruct(taskConfigMap)
	require.NoError(t, err)

	return &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "analyze_data",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}
}

func findChildForCallbackTest(
	t *testing.T,
	ctx context.Context,
	clients *harness.Clients,
	workflowExecutionID string,
) *agentexecv1.AgentExecution {
	t.Helper()

	expectedParentID := fmt.Sprintf("workflow-exec-%s", workflowExecutionID)
	deadline := time.Now().Add(60 * time.Second)

	for time.Now().Before(deadline) {
		resp, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{})
		if err != nil {
			t.Logf("warning: list agent executions failed: %v", err)
			time.Sleep(1 * time.Second)
			continue
		}

		for _, ae := range resp.GetEntries() {
			if ae.GetSpec().GetParentWorkflowId() == expectedParentID {
				return ae
			}
		}

		time.Sleep(1 * time.Second)
	}

	t.Logf("warning: could not find child agent execution for workflow %s within timeout", workflowExecutionID)
	return nil
}
