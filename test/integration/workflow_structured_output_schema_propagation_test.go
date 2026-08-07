//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflow_SchemaPropagation is a hard regression test for the production
// failure where structuredOutputSchema was intermittently missing from the
// agent execution spec, even though the workflow YAML correctly defined
// output.schema on the agent_call task.
//
// Root cause hypothesis: the schema is lost during Temporal serialization
// between the workflow sandbox (where the CallAgentTaskBuilder resolves
// expressions and calls ctx.callAgent) and the CallAgent activity (where
// the schema is read from config.output.schema and set on executionConfig).
//
// This test exercises the FULL pipeline through the Temporal boundary:
//
//	YAML → Java validation → CNCF DSL → runner hydration → workflow engine
//	→ expression resolution → Temporal activity serialization → CallAgent
//	→ agent execution creation with structuredOutputSchema
//
// Unlike unit tests (which mock ctx.callAgent), this catches serialization
// bugs that only manifest when data crosses the Temporal wire boundary.
func TestWorkflow_SchemaPropagation(t *testing.T) {
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
			deployer := harness.NewFixtureDeployer(clients, "schema-prop-"+h.Name, nil)
			defer deployer.Cleanup(ctx)

			wfWaiter := harness.NewExecutionWaiter(clients.ExecutionQuery, nil)

			agent := harness.CreateAgent(t, ctx, clients, "test-schema-prop-"+h.Name,
				"You are a data analyst. When asked to analyze data, respond with ONLY "+
					"a JSON object matching the requested schema. No markdown, no prose.")

			// Test 1: Complex nested schema (daily-notification-plan pattern)
			// This uses the exact schema from the production workflow.
			t.Run("ComplexCohortSchema_ReachesChildExecution", func(t *testing.T) {
				schema := dailyNotificationPlanSchema(t)
				harnessStr := ""
				if h.Name == "cursor" {
					harnessStr = "cursor"
				}

				wf := buildSchemaPropWorkflow(t,
					"sp-cohort-"+h.Name,
					agent.GetMetadata().GetSlug(),
					harnessStr,
					schema,
					"Analyze daily player data. "+
						"Respond with a JSON object containing: executive_summary (string), "+
						"dau (number), cohorts (array of {name, size, action_needed}), "+
						"anomalies (array of {metric, severity, description}), and data_quality_notes (string).",
				)

				_, exec, err := deployer.DeployAndExecute(ctx, wf, "")
				require.NoError(t, err)

				executionID := exec.GetMetadata().GetId()
				t.Logf("Workflow execution created: id=%s", executionID)

				completed, err := wfWaiter.WaitForTerminal(ctx, executionID, 8*time.Minute)
				require.NoError(t, err)
				t.Logf("Workflow phase: %s, error: %s",
					completed.GetStatus().GetPhase(), completed.GetStatus().GetError())

				childExec := findChildExecution(t, ctx, clients, executionID)
				require.NotNil(t, childExec,
					"child agent execution must exist for workflow %s", executionID)

				// HARD ASSERTION: schema must be on the child execution spec
				childSchema := childExec.GetSpec().GetExecutionConfig().GetStructuredOutputSchema()
				require.NotNil(t, childSchema,
					"structuredOutputSchema MUST be present on child agent execution spec. "+
						"If nil, the schema was lost during Temporal serialization between "+
						"the workflow sandbox and the CallAgent activity. "+
						"Child execution: %s", childExec.GetMetadata().GetId())

				// Verify the complex nested structure survived serialization
				schemaFields := childSchema.GetFields()
				t.Logf("Schema top-level keys on child execution: %v", harness.StructKeys(childSchema))

				propVal, hasProps := schemaFields["properties"]
				require.True(t, hasProps, "schema missing 'properties' key")
				props := propVal.GetStructValue()
				require.NotNil(t, props)

				// Verify nested array schema survived
				cohortsVal, hasCohorts := props.GetFields()["cohorts"]
				assert.True(t, hasCohorts, "schema.properties missing 'cohorts'")
				if hasCohorts {
					cohortsObj := cohortsVal.GetStructValue()
					require.NotNil(t, cohortsObj)
					assert.Equal(t, "array", cohortsObj.GetFields()["type"].GetStringValue(),
						"cohorts.type should be 'array'")

					itemsVal, hasItems := cohortsObj.GetFields()["items"]
					assert.True(t, hasItems, "cohorts missing 'items' — nested schema dropped")
					if hasItems {
						itemsObj := itemsVal.GetStructValue()
						require.NotNil(t, itemsObj)
						reqVal, hasReq := itemsObj.GetFields()["required"]
						assert.True(t, hasReq, "cohorts.items missing 'required' — deep nesting lost")
						if hasReq {
							reqList := reqVal.GetListValue()
							require.NotNil(t, reqList)
							assert.GreaterOrEqual(t, len(reqList.GetValues()), 3,
								"cohorts.items.required should have at least 3 fields")
						}
					}
				}

				// Verify enum survived
				anomaliesVal, hasAnomalies := props.GetFields()["anomalies"]
				assert.True(t, hasAnomalies, "schema.properties missing 'anomalies'")
				if hasAnomalies {
					anomObj := anomaliesVal.GetStructValue()
					if anomObj != nil {
						itemsVal := anomObj.GetFields()["items"]
						if itemsVal != nil {
							itemsObj := itemsVal.GetStructValue()
							if itemsObj != nil {
								propsVal := itemsObj.GetFields()["properties"]
								if propsVal != nil {
									sevVal := propsVal.GetStructValue().GetFields()["severity"]
									if sevVal != nil {
										sevObj := sevVal.GetStructValue()
										enumVal := sevObj.GetFields()["enum"]
										if enumVal != nil {
											enumList := enumVal.GetListValue()
											assert.Equal(t, 2, len(enumList.GetValues()),
												"severity.enum should have 2 values (warning, critical)")
										}
									}
								}
							}
						}
					}
				}

				// Verify required array at top level
				reqVal, hasReq := schemaFields["required"]
				assert.True(t, hasReq, "schema missing top-level 'required'")
				if hasReq {
					reqList := reqVal.GetListValue()
					require.NotNil(t, reqList)
					reqStrs := make([]string, 0, len(reqList.GetValues()))
					for _, v := range reqList.GetValues() {
						reqStrs = append(reqStrs, v.GetStringValue())
					}
					assert.Contains(t, reqStrs, "executive_summary")
					assert.Contains(t, reqStrs, "cohorts")
					assert.Contains(t, reqStrs, "anomalies")
				}
			})

			// Test 2: Simple schema for comparison baseline
			t.Run("SimpleSchema_ReachesChildExecution", func(t *testing.T) {
				schema := harness.SummaryScoreSchema(t)
				harnessStr := ""
				if h.Name == "cursor" {
					harnessStr = "cursor"
				}

				wf := buildSchemaPropWorkflow(t,
					"sp-simple-"+h.Name,
					agent.GetMetadata().GetSlug(),
					harnessStr,
					schema,
					"Summarize user engagement and give a score. "+
						`Respond with ONLY: {"summary": "...", "score": 8}`,
				)

				_, exec, err := deployer.DeployAndExecute(ctx, wf, "")
				require.NoError(t, err)

				completed, err := wfWaiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 8*time.Minute)
				require.NoError(t, err)
				t.Logf("Workflow phase: %s", completed.GetStatus().GetPhase())

				childExec := findChildExecution(t, ctx, clients, exec.GetMetadata().GetId())
				require.NotNil(t, childExec)

				childSchema := childExec.GetSpec().GetExecutionConfig().GetStructuredOutputSchema()
				require.NotNil(t, childSchema,
					"structuredOutputSchema must be present even for simple schemas")

				props := childSchema.GetFields()["properties"].GetStructValue()
				require.NotNil(t, props)
				_, hasSummary := props.GetFields()["summary"]
				_, hasScore := props.GetFields()["score"]
				assert.True(t, hasSummary, "schema missing 'summary' property")
				assert.True(t, hasScore, "schema missing 'score' property")
			})

			// Test 3: Schema with no model config (isolates schema-only path)
			t.Run("SchemaOnly_NoModelConfig", func(t *testing.T) {
				schema := harness.SummaryScoreSchema(t)

				taskConfig, err := structpb.NewStruct(map[string]any{
					"agent":   agent.GetMetadata().GetSlug(),
					"message": "Summarize and score. Respond with JSON only.",
					"output": map[string]any{
						"schema":     schema.AsMap(),
						"on_invalid": "ON_INVALID_FAIL",
					},
				})
				require.NoError(t, err)

				wf := &workflowv1.Workflow{
					ApiVersion: harness.TestAPIVersion,
					Kind:       "Workflow",
					Metadata:   &apiresource.ApiResourceMetadata{Name: "sp-nomodel-" + h.Name, Org: harness.TestOrg},
					Spec: &workflowv1.WorkflowSpec{
						Document: &workflowv1.WorkflowDocument{
							Dsl: "1.0.0", Namespace: harness.TestOrg,
							Name: "sp-nomodel-" + h.Name, Version: "1.0.0",
						},
						Tasks: []*workflowv1.WorkflowTask{
							{Name: "analyze", Kind: workflowv1.WorkflowTaskKind_agent_call, TaskConfig: taskConfig},
						},
					},
				}

				_, exec, err := deployer.DeployAndExecute(ctx, wf, "")
				require.NoError(t, err)

				completed, err := wfWaiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 8*time.Minute)
				require.NoError(t, err)
				t.Logf("Workflow phase: %s", completed.GetStatus().GetPhase())

				childExec := findChildExecution(t, ctx, clients, exec.GetMetadata().GetId())
				require.NotNil(t, childExec)

				childSchema := childExec.GetSpec().GetExecutionConfig().GetStructuredOutputSchema()
				require.NotNil(t, childSchema,
					"structuredOutputSchema must be set even without model config")
			})
		})
	}
}

// --- Schema and workflow builders ---

func dailyNotificationPlanSchema(t *testing.T) *structpb.Struct {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{
		"type":     "object",
		"required": []any{"executive_summary", "cohorts", "anomalies"},
		"properties": map[string]any{
			"executive_summary": map[string]any{"type": "string"},
			"dau":               map[string]any{"type": "number"},
			"dau_trend_pct":     map[string]any{"type": "number"},
			"cohorts": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":     "object",
					"required": []any{"name", "size", "action_needed"},
					"properties": map[string]any{
						"name":            map[string]any{"type": "string"},
						"size":            map[string]any{"type": "number"},
						"retention_trend": map[string]any{"type": "string"},
						"action_needed":   map[string]any{"type": "boolean"},
					},
				},
			},
			"anomalies": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"metric":      map[string]any{"type": "string"},
						"description": map[string]any{"type": "string"},
						"severity": map[string]any{
							"type": "string",
							"enum": []any{"warning", "critical"},
						},
					},
				},
			},
			"data_quality_notes": map[string]any{"type": "string"},
		},
	})
	require.NoError(t, err)
	return schema
}

func buildSchemaPropWorkflow(
	t *testing.T,
	name, agentSlug, harnessName string,
	schema *structpb.Struct,
	message string,
) *workflowv1.Workflow {
	t.Helper()

	taskConfigMap := map[string]any{
		"agent":   agentSlug,
		"message": message,
		"run_config": map[string]any{
			"model_name": "claude-sonnet-4",
		},
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
		Metadata:   &apiresource.ApiResourceMetadata{Name: name, Org: harness.TestOrg},
		Spec: &workflowv1.WorkflowSpec{
			Document: &workflowv1.WorkflowDocument{
				Dsl: "1.0.0", Namespace: harness.TestOrg,
				Name: name, Version: "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "analyze_player_data",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}
}

func findChildExecution(
	t *testing.T,
	ctx context.Context,
	clients *harness.Clients,
	workflowExecutionID string,
) *agentexecv1.AgentExecution {
	t.Helper()

	expectedParentID := fmt.Sprintf("workflow-exec-%s", workflowExecutionID)
	deadline := time.Now().Add(90 * time.Second)

	for time.Now().Before(deadline) {
		resp, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{})
		if err != nil {
			t.Logf("warning: list agent executions failed: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}

		for _, ae := range resp.GetEntries() {
			if ae.GetSpec().GetParentWorkflowId() == expectedParentID {
				return ae
			}
		}

		time.Sleep(2 * time.Second)
	}

	t.Logf("could not find child agent execution for workflow %s within 90s", workflowExecutionID)
	return nil
}
