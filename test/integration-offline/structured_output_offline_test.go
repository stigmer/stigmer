//go:build integration

package offline

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// requireSOPrereqs checks that agent execution infrastructure is available.
func requireSOPrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "gRPC connection required")
}

// soTestSetup creates the common resources for a structured output offline test:
// mock LLM, runner, agent, session, and routes the session to the mock runner.
func soTestSetup(
	t *testing.T,
	ctx context.Context,
	entries []harness.RecordedLLMEntry,
	agentName string,
) (*harness.MockLLMProxyServer, *harness.Clients, string) {
	t.Helper()

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients, agentName,
		"You are a test assistant. Follow instructions precisely.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	return mockLLM, clients, sessionID
}

// runSOExecution creates and waits for an agent execution with a structured output schema.
func runSOExecution(
	t *testing.T,
	ctx context.Context,
	clients *harness.Clients,
	sessionID string,
	message string,
	schema *structpb.Struct,
) *agentexecv1.AgentExecution {
	t.Helper()

	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
		message,
		harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
			StructuredOutputSchema: schema,
			MaxToolRounds:          10,
		}),
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err, "execution should reach terminal phase")
	return result
}

// TestOffline_StructuredOutput_PureJsonResponse verifies that the extraction
// pipeline correctly handles a pure JSON response from the agent.
func TestOffline_StructuredOutput_PureJsonResponse(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"summary": "Test analysis of hello", "score": 8}`,
			200, 30,
		)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-pure-json")

	schema := harness.SummaryScoreSchema(t)
	result := runSOExecution(t, ctx, clients, sessionID,
		"Analyze the word hello.", schema)

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertStructuredOutputPopulated(t, result)
	harness.AssertStructuredOutputHasKeys(t, result, "summary", "score")
}

// TestOffline_StructuredOutput_CodeFencedJson verifies Tier 1.5 extraction:
// JSON wrapped in a ```json code fence.
func TestOffline_StructuredOutput_CodeFencedJson(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"Here is my analysis:\n\n```json\n{\"summary\": \"Analysis of world\", \"score\": 7}\n```\n\nHope that helps!",
			200, 40,
		)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-code-fence")

	schema := harness.SummaryScoreSchema(t)
	result := runSOExecution(t, ctx, clients, sessionID,
		"Analyze the word world.", schema)

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertStructuredOutputPopulated(t, result)
	harness.AssertStructuredOutputHasKeys(t, result, "summary", "score")
}

// TestOffline_StructuredOutput_MarkdownProse verifies Tier 2 extraction:
// agent returns pure markdown with no JSON, so extraction must use LLM-based
// extraction or return nil.
func TestOffline_StructuredOutput_MarkdownProse(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"# Blue Color Analysis\n\nBlue is a primary color associated with calm and serenity.\n\n## Key Points\n\n- Often used in corporate branding\n- Represents trust and stability\n- Score: approximately 8 out of 10 for positive associations",
			200, 60,
		)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-markdown")

	schema := harness.SummaryScoreSchema(t)
	result := runSOExecution(t, ctx, clients, sessionID,
		"Write a detailed markdown report about the color blue.", schema)

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	so := result.GetStatus().GetStructuredOutput()
	if so == nil {
		t.Log("structuredOutput is nil for markdown prose -- Tier 2 extraction not available or skipped in offline mode")
	} else {
		harness.AssertStructuredOutputHasKeys(t, result, "summary", "score")
	}
}

// TestOffline_StructuredOutput_TrailingCommas verifies extraction handles
// invalid JSON with trailing commas (common LLM output quirk).
func TestOffline_StructuredOutput_TrailingCommas(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"summary": "test result", "score": 5, }`,
			200, 20,
		)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-trailing-comma")

	schema := harness.SummaryScoreSchema(t)
	result := runSOExecution(t, ctx, clients, sessionID,
		"Respond with JSON.", schema)

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	so := result.GetStatus().GetStructuredOutput()
	if so == nil {
		t.Log("structuredOutput is nil -- trailing commas caused extraction failure (B7)")
	} else {
		harness.AssertStructuredOutputHasKeys(t, result, "summary", "score")
		t.Log("extraction handled trailing commas gracefully")
	}
}

// TestOffline_StructuredOutput_MultipleCodeFences verifies which code fence
// the extraction pipeline picks when the response contains multiple fences.
// The correct fence should be the one matching the schema.
func TestOffline_StructuredOutput_MultipleCodeFences(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"Here are two results:\n\n"+
				"```json\n{\"debug\": true, \"version\": \"1.0\"}\n```\n\n"+
				"And the actual result:\n\n"+
				"```json\n{\"summary\": \"actual result\", \"score\": 8}\n```",
			200, 50,
		)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-multi-fence")

	schema := harness.SummaryScoreSchema(t)
	result := runSOExecution(t, ctx, clients, sessionID,
		"Analyze something.", schema)

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	so := result.GetStatus().GetStructuredOutput()
	if so != nil {
		_, hasDebug := so.GetFields()["debug"]
		_, hasSummary := so.GetFields()["summary"]
		if hasDebug && !hasSummary {
			t.Error("extraction picked the FIRST code fence (debug JSON) -- silent wrong data (B3)")
		} else if hasSummary {
			t.Log("extraction correctly picked the schema-matching fence")
		}
	}
}

// TestOffline_StructuredOutput_ExtraFields verifies whether the extraction
// pipeline strips fields not defined in the schema when additionalProperties
// is false.
func TestOffline_StructuredOutput_ExtraFields(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"summary": "test", "score": 5, "extra": "should not be here"}`,
			200, 25,
		)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-extra-fields")

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

	result := runSOExecution(t, ctx, clients, sessionID,
		"Respond with JSON.", schema)

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertStructuredOutputPopulated(t, result)

	so := result.GetStatus().GetStructuredOutput()
	if so != nil {
		_, hasExtra := so.GetFields()["extra"]
		if hasExtra {
			t.Log("extra fields present despite additionalProperties: false -- validation does not strip extra fields (D5)")
		} else {
			t.Log("extra fields were stripped -- additionalProperties enforcement works")
		}
	}
}

// TestOffline_StructuredOutput_MissingRequiredField verifies behavior when the
// agent's response JSON is missing a required field.
func TestOffline_StructuredOutput_MissingRequiredField(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"summary": "test only summary"}`,
			200, 15,
		)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-missing-req")

	schema := harness.SummaryScoreSchema(t)
	result := runSOExecution(t, ctx, clients, sessionID,
		"Respond with JSON.", schema)

	so := result.GetStatus().GetStructuredOutput()
	if so != nil {
		_, hasScore := so.GetFields()["score"]
		if !hasScore {
			t.Log("structuredOutput accepted without required 'score' -- validation is shallow (D1)")
		} else {
			t.Log("score field present (LLM or extraction may have populated it)")
		}
	} else {
		phase := result.GetStatus().GetPhase()
		if phase == agentexecv1.ExecutionPhase_EXECUTION_FAILED {
			t.Log("execution failed when required field missing -- strict validation enforced")
		} else {
			t.Log("structuredOutput is nil but execution completed -- extraction returned nothing")
		}
	}
}

// TestOffline_StructuredOutput_WrongFieldType verifies behavior when a field
// has the wrong type (string instead of number).
func TestOffline_StructuredOutput_WrongFieldType(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"summary": "test", "score": "eight"}`,
			200, 20,
		)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-wrong-type")

	schema := harness.SummaryScoreSchema(t)
	result := runSOExecution(t, ctx, clients, sessionID,
		"Respond with JSON.", schema)

	so := result.GetStatus().GetStructuredOutput()
	if so != nil {
		scoreVal := so.GetFields()["score"]
		if scoreVal != nil {
			if _, isStr := scoreVal.GetKind().(*structpb.Value_StringValue); isStr {
				t.Log("score accepted as string -- type validation not enforced (D1)")
			} else {
				t.Log("score is correct type (number)")
			}
		}
	}
}

// TestOffline_StructuredOutput_NestedArrayOfObjects verifies extraction of
// nested arrays with object items.
func TestOffline_StructuredOutput_NestedArrayOfObjects(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"items": [{"name": "Go", "count": 85}, {"name": "Python", "count": 92}, {"name": "Rust", "count": 75}]}`,
			200, 40,
		)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-nested-arr")

	schema := harness.NestedArraySchema(t)
	result := runSOExecution(t, ctx, clients, sessionID,
		"List programming languages.", schema)

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertStructuredOutputPopulated(t, result)
	harness.AssertNestedArrayStructure(t, result, "items", []string{"name", "count"})

	so := result.GetStatus().GetStructuredOutput()
	if so != nil {
		items := so.GetFields()["items"]
		if items != nil && items.GetListValue() != nil {
			assert.Equal(t, 3, len(items.GetListValue().GetValues()), "should have 3 items")
		}
	}
}

// TestOffline_StructuredOutput_SchemaRoundTrip verifies that JSON schemas
// survive the proto/structpb serialization round-trip.
func TestOffline_StructuredOutput_SchemaRoundTrip(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(`{"summary": "hello", "score": 5}`, 100, 15)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(`{"items": [{"name": "Go", "count": 1}]}`, 100, 20)),
		harness.BuildLLMEntry(2, harness.AnthropicTextResponse(`{"name": "Test"}`, 100, 10)),
		harness.BuildLLMEntry(3, harness.AnthropicTextResponse(`{"cohorts": [{"name": "A", "size": 1, "action_needed": false}]}`, 100, 25)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-roundtrip")

	schemas := map[string]*structpb.Struct{
		"SummaryScore":  harness.SummaryScoreSchema(t),
		"NestedArray":   harness.NestedArraySchema(t),
		"NullableField": harness.NullableFieldSchema(t),
		"CohortsArray":  harness.CohortsArraySchema(t),
	}

	for name, schema := range schemas {
		t.Run(name, func(t *testing.T) {
			exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
				"Say hello.",
				harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
					StructuredOutputSchema: schema,
					MaxToolRounds:          10,
				}),
				harness.WithAutoApproveAll(true),
			)

			persisted := exec.GetSpec().GetExecutionConfig().GetStructuredOutputSchema()
			require.NotNilf(t, persisted, "schema %q dropped during creation (A1)", name)

			for _, key := range []string{"type", "properties"} {
				_, exists := persisted.GetFields()[key]
				assert.Truef(t, exists, "schema keyword %q missing after round-trip for %q (A1/A2)", key, name)
			}

			props := persisted.GetFields()["properties"]
			assert.NotNilf(t, props, "'properties' lost during round-trip for schema %q (A1)", name)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, _ = waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
		})
	}
}

// TestOffline_StructuredOutput_NoSchemaProducesNoOutput verifies that an
// execution without a schema does NOT produce structuredOutput.
func TestOffline_StructuredOutput_NoSchemaProducesNoOutput(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"summary": "hello", "score": 5}`,
			100, 15,
		)),
	}

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-no-schema")

	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
		"Say hello with JSON.",
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err)

	so := result.GetStatus().GetStructuredOutput()
	assert.Nil(t, so, "structuredOutput should be nil when no schema is provided")
}

// --- v3 Migration Baseline ---
//
// TestOffline_StructuredOutput_NativePath_TextBasedExtraction documents the
// current v2 behavior: structured output on the native path is extracted
// server-side from the agent's final text message (JSON parsing + code fence
// extraction). The runner does NOT use deepagents' structuredResponse because
// it is an UntrackedValue invisible to v2 streamEvents() and getState().
//
// This test serves as a baseline for Phase 3 of the v3 streaming migration.
// After v3 migration:
//   - Structured output will come from run.output.structuredResponse (reliable)
//   - The assertion should still pass (same API result, different source)
//   - But the source field will be populated by the runner, not server-side parsing
func TestOffline_StructuredOutput_NativePath_TextBasedExtraction(t *testing.T) {
	t.Parallel()
	requireSOPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	// Agent returns a JSON object embedded in natural language text.
	// The server-side extraction pipeline must parse it from the text.
	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"Based on my analysis, here is the result:\n\n```json\n{\"summary\": \"v2 baseline test\", \"score\": 10}\n```\n\nThis output was extracted from text, not deepagents structuredResponse.",
			250, 50,
		)),
	}

	schema := harness.SummaryScoreSchema(t)

	_, clients, sessionID := soTestSetup(t, ctx, entries, "offline-so-v2-baseline")

	result := runSOExecution(t, ctx, clients, sessionID,
		"Analyze this and respond with JSON matching the schema.", schema)

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	so := result.GetStatus().GetStructuredOutput()
	require.NotNil(t, so, "structured output should be populated via server-side text extraction")
	harness.AssertStructuredOutputHasKeys(t, result, "summary", "score")

	summary := so.GetFields()["summary"].GetStringValue()
	assert.Equal(t, "v2 baseline test", summary,
		"extracted value should match the JSON in the agent's text response")

	score := so.GetFields()["score"].GetNumberValue()
	assert.Equal(t, float64(10), score,
		"extracted numeric value should match the JSON in the agent's text response")

	t.Log("v2 baseline: structured output extracted from text (server-side parsing). " +
		"After v3 migration, this will come from run.output.structuredResponse.")
}
