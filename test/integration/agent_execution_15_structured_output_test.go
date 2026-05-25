//go:build integration

package integration

import (
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestAgentExecution_StructuredOutput validates the structured output extraction pipeline
// at the agent execution level across both harnesses (native + cursor).
//
// These tests exercise the fundamental contract:
//   schema on execution → agent completes → status.structured_output populated.
//
// Philosophy: These tests DISCOVER issues in the pipeline, not fix them.
// Each test documents which failure modes from the plan it targets (A1-A3, B1-B9, D1-D5, E1-E5).
func TestAgentExecution_StructuredOutputPipeline(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, nil)

			agent := harness.CreateAgent(t, ctx, clients, "test-structured-output-"+h.Name,
				"You are a test assistant. Follow instructions precisely. "+
					"When asked to output JSON, output ONLY JSON unless told otherwise.")
			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			// --- Happy Path: Pure JSON ---

			t.Run("PureJsonResponse", func(t *testing.T) {
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Analyze the word 'hello'. Respond with ONLY a JSON object, nothing else. "+
						"The JSON must have exactly two fields: 'summary' (a string) and 'score' (a number 1-10).",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				harness.AssertStructuredOutputHasKeys(t, completed, "summary", "score")
			})

			// --- Markdown Prose: Tier 2 extraction needed ---

			t.Run("MarkdownProse", func(t *testing.T) {
				// Agent produces markdown, NEVER raw JSON -> extraction must use Tier 2 (LLM).
				// Targets: B1, B2, E4
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Write a detailed markdown report about the color blue. Use headings and bullet points. "+
						"Do NOT output any JSON anywhere. Write purely in natural language.",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				harness.AssertStructuredOutputHasKeys(t, completed, "summary", "score")
			})

			// --- Code-fenced JSON: Tier 1.5 ---

			t.Run("CodeFencedJson", func(t *testing.T) {
				// Targets: B3 (first code fence has wrong JSON)
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Analyze the word 'world'. Respond with your answer inside a JSON code fence like ```json ... ```. "+
						"The JSON must have 'summary' (string) and 'score' (number 1-10).",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				harness.AssertStructuredOutputHasKeys(t, completed, "summary", "score")
			})

			// --- Empty final message: B1 ---

			t.Run("EmptyFinalMessage", func(t *testing.T) {
				// Agent uses tool then stops -> empty finalText -> extraction skipped.
				// Targets: B1. When final turn is tool-only, structuredOutput may be nil.
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Use any available tool to check something, then stop immediately. "+
						"Do not write any text after using the tool.",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				if h.Name == "cursor" {
					// The Cursor path injects a strong JSON instruction into
					// the prompt, so the agent typically responds with JSON
					// even in tool-only scenarios. Structured output being
					// populated is correct Cursor behavior, not an error.
					so := completed.GetStatus().GetStructuredOutput()
					if so != nil {
						t.Logf("Cursor harness produced structured output in tool-only scenario (expected): %d fields", len(so.GetFields()))
					}
				} else {
					harness.AssertStructuredOutputNil(t, completed)
				}
			})

			// --- Multi-turn verbose: B2 ---

			t.Run("MultiTurnVerbose", func(t *testing.T) {
				// JSON in middle, "Done!" at end -> extraction should still find JSON.
				// Targets: B2
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Analyze the word 'sun'. Follow these steps:\n"+
						"1. First, write a paragraph explaining your methodology\n"+
						"2. Output the JSON result with 'summary' and 'score'\n"+
						"3. Finally, write 'Analysis complete. Done!' as your last line",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				harness.AssertStructuredOutputHasKeys(t, completed, "summary", "score")
			})

			// --- Nested schema: D1, D2 ---

			t.Run("NestedSchema", func(t *testing.T) {
				schema := harness.NestedArraySchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"List 3 programming languages with popularity scores. "+
						"Respond with ONLY a JSON object: {\"items\": [{\"name\": \"Go\", \"count\": 85}, ...]}",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				harness.AssertNestedArrayStructure(t, completed, "items", []string{"name", "count"})
			})

			// --- Nullable field: A2 ---

			t.Run("SchemaWithNullableField", func(t *testing.T) {
				// Targets: A2 (structpb cannot represent type arrays like ["string", "null"])
				schema := harness.NullableFieldSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Respond with ONLY: {\"name\": \"Test User\", \"notes\": null}",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				// Check if schema survived serialization
				harness.AssertExecutionHasSchema(t, completed)
				harness.AssertStructuredOutputPopulated(t, completed)
				if completed.GetStatus().GetStructuredOutput() != nil {
					harness.AssertStructuredOutputHasKeys(t, completed, "name")
				}
			})

			// --- Schema persisted on execution: A1 ---

			t.Run("SchemaStoredOnExecution", func(t *testing.T) {
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Say hello. Output: {\"summary\": \"hello\", \"score\": 5}",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				// Schema should be persisted at creation time
				harness.AssertExecutionHasSchema(t, exec)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)
				harness.AssertExecutionHasSchema(t, completed)
				t.Log(harness.FormatStructuredOutputSummary(completed))
			})
		})
	}
}

// TestAgentExecution_StructuredOutput_EdgeCases tests adversarial extraction scenarios.
func TestAgentExecution_StructuredOutputPipeline_EdgeCases(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, nil)

			agent := harness.CreateAgent(t, ctx, clients, "test-so-edge-"+h.Name,
				"You are a test assistant. Follow instructions precisely.")
			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			t.Run("TrailingCommasInJson", func(t *testing.T) {
				// Targets: B7 -- trailing commas are a common LLM quirk that the
				// pipeline should handle gracefully (via lenient parsing or Tier 2).
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Respond with ONLY this: {\"summary\": \"test\", \"score\": 5, } — include the trailing comma.",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				harness.AssertStructuredOutputHasKeys(t, completed, "summary", "score")
			})

			t.Run("MultipleCodeFences_WrongFirst", func(t *testing.T) {
				// Targets: B3 -- when multiple JSON code fences exist, extraction
				// should pick the one matching the schema, not blindly the first.
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Output exactly two JSON code fences:\n"+
						"First: ```json\n{\"debug\": true, \"version\": \"1.0\"}\n```\n"+
						"Second: ```json\n{\"summary\": \"actual result\", \"score\": 8}\n```\n"+
						"Output exactly these, nothing else.",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				so := completed.GetStatus().GetStructuredOutput()
				assert.NotNil(t, so.GetFields()["summary"],
					"extraction should pick the schema-matching fence with 'summary', not the debug fence")
			})

			t.Run("ExtraFieldsNotStripped", func(t *testing.T) {
				// Targets: D5 -- additionalProperties: false. The pipeline should
				// still produce structuredOutput; extra fields may or may not be stripped.
				schema, err := structpb.NewStruct(map[string]any{
					"type": "object",
					"properties": map[string]any{
						"summary": map[string]any{"type": "string"},
						"score":   map[string]any{"type": "number"},
					},
					"required":             []any{"summary", "score"},
					"additionalProperties": false,
				})
				require.NoError(t, err)

				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Respond with ONLY: {\"summary\": \"test\", \"score\": 5, \"extra\": \"should not be here\"}",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err2 := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err2)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				harness.AssertStructuredOutputHasKeys(t, completed, "summary", "score")
			})

			t.Run("MissingRequiredField", func(t *testing.T) {
				// Targets: D1 -- required field validation. The pipeline should
				// still produce structuredOutput with whatever fields were extracted.
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Respond with ONLY: {\"summary\": \"test\"}. Do NOT include 'score'.",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				harness.AssertStructuredOutputHasKeys(t, completed, "summary")
			})

			t.Run("WrongFieldType", func(t *testing.T) {
				// Targets: D1 -- type validation. The pipeline should still produce
				// structuredOutput even when field types don't match the schema.
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Respond with ONLY: {\"summary\": \"test\", \"score\": \"eight\"}. score must be a STRING.",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				harness.AssertStructuredOutputHasKeys(t, completed, "summary", "score")
			})

			t.Run("NoSchemaProducesNoOutput", func(t *testing.T) {
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Say hello. Respond with: {\"summary\": \"hello\", \"score\": 5}",
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)

				harness.AssertStructuredOutputNil(t, completed)
			})

			t.Run("FailedExecution_NoStructured", func(t *testing.T) {
				schema := harness.SummaryScoreSchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"{{INVALID_TEMPLATE_TRIGGER_ERROR}}",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				phase := completed.GetStatus().GetPhase()
				if phase == agentexecv1.ExecutionPhase_EXECUTION_FAILED {
					harness.AssertStructuredOutputNil(t, completed)
				}
				// If the agent completes despite invalid input, that's acceptable --
				// LLMs can be resilient to malformed prompts.
			})

			t.Run("CohortsArrayOfObjects", func(t *testing.T) {
				// Targets: D2 — items schema for arrays
				schema := harness.CohortsArraySchema(t)
				exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
					"Segment users into 3 cohorts. Respond with ONLY JSON: "+
						"{\"cohorts\": [{\"name\": \"Power Users\", \"size\": 1500, \"action_needed\": false}, ...]}",
					harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
						StructuredOutputSchema: schema,
						MaxToolRounds:          10,
					}),
					harness.WithAutoApproveAll(true),
				)

				completed, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err)
				t.Log(harness.FormatStructuredOutputSummary(completed))

				harness.AssertStructuredOutputPopulated(t, completed)
				so := completed.GetStatus().GetStructuredOutput()
				if so != nil {
					harness.AssertNestedArrayStructure(t, completed, "cohorts", []string{"name", "size", "action_needed"})
					cohorts := so.GetFields()["cohorts"]
					if cohorts != nil && cohorts.GetListValue() != nil {
						t.Logf("Got %d cohorts", len(cohorts.GetListValue().GetValues()))
						assert.Greater(t, len(cohorts.GetListValue().GetValues()), 0, "cohorts should not be empty")
					}
				}
			})
		})
	}
}

// TestAgentExecution_StructuredOutput_SchemaRoundTrip tests whether JSON Schemas
// survive the full serialization round-trip through proto/structpb.
func TestAgentExecution_StructuredOutputPipeline_SchemaRoundTrip(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	// Use native harness; we only need schema persistence, not LLM
	agent := harness.CreateAgent(t, ctx, clients, "test-schema-roundtrip",
		"You are a test assistant.")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			schemas := map[string]*structpb.Struct{
				"SummaryScore":  harness.SummaryScoreSchema(t),
				"NestedArray":   harness.NestedArraySchema(t),
				"NullableField": harness.NullableFieldSchema(t),
				"CohortsArray":  harness.CohortsArraySchema(t),
			}

			for name, schema := range schemas {
				t.Run(name, func(t *testing.T) {
					originalKeys := harness.StructKeys(schema)

					exec := harness.CreateTestAgentExecution(t, ctx, clients, session.GetMetadata().GetId(),
						"Say hello.",
						harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
							StructuredOutputSchema: schema,
							MaxToolRounds:          10,
						}),
						harness.WithAutoApproveAll(true),
					)

					persisted := exec.GetSpec().GetExecutionConfig().GetStructuredOutputSchema()
					if persisted == nil {
						t.Fatalf("[A1 CONFIRMED] Schema %q dropped during creation. Original keys: %v", name, originalKeys)
					}

					persistedKeys := harness.StructKeys(persisted)
					t.Logf("Schema %q: original=%v, persisted=%v", name, originalKeys, persistedKeys)

					for _, key := range []string{"type", "properties", "required"} {
						if _, exists := persisted.GetFields()[key]; !exists {
							t.Logf("[A1/A2] Schema keyword %q missing after round-trip for %q", key, name)
						}
					}

					props := persisted.GetFields()["properties"]
					assert.NotNil(t, props, "[A1] 'properties' lost during round-trip for schema %q", name)

					// Let the execution finish to avoid orphaned executions
					waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, nil)
					_, _ = waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 4*time.Minute)
				})
			}
		})
	}
}
