package validation

import (
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/registry"
	"google.golang.org/protobuf/types/known/structpb"
)

func makeAgentCallTask(name string, harness string, model string) *workflowv1.WorkflowTask {
	config := map[string]interface{}{}
	if model != "" {
		config["config"] = map[string]interface{}{
			"model": model,
		}
	}
	config["agent"] = "test-agent"
	config["message"] = "test message"
	if harness != "" {
		config["harness"] = harness
	}
	cfg, _ := structpb.NewStruct(config)
	return &workflowv1.WorkflowTask{
		Name:       name,
		Kind:       workflowv1.WorkflowTaskKind_agent_call,
		TaskConfig: cfg,
	}
}

func makeLlmCallTask(name string, model string) *workflowv1.WorkflowTask {
	config := map[string]interface{}{
		"model":  model,
		"prompt": "test prompt",
	}
	cfg, _ := structpb.NewStruct(config)
	return &workflowv1.WorkflowTask{
		Name:       name,
		Kind:       workflowv1.WorkflowTaskKind_llm_call,
		TaskConfig: cfg,
	}
}

func makeEvalTask(name string, model string) *workflowv1.WorkflowTask {
	config := map[string]interface{}{
		"model":   model,
		"subject": "test subject",
		"rubric":  "test rubric",
	}
	cfg, _ := structpb.NewStruct(config)
	return &workflowv1.WorkflowTask{
		Name:       name,
		Kind:       workflowv1.WorkflowTaskKind_eval,
		TaskConfig: cfg,
	}
}

func TestValidateModelReferences_ValidNativeModels(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeLlmCallTask("classify", "claude-sonnet-4.6"),
			makeLlmCallTask("summarize", "gpt-4o"),
			makeEvalTask("evaluate", "claude-opus-4.6"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 0 {
		t.Errorf("Expected no errors for valid native models, got: %v", errors)
	}
}

// Provider api ids (apiModelId in the registry) are accepted as aliases of
// the canonical id: the runner passes them to the provider verbatim, so they
// are executable and rejecting them at apply time would be stricter than
// runtime (stigmer/stigmer#240, "Attempt 2").
func TestValidateModelReferences_ApiModelIdAlias_Accepted(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeLlmCallTask("summarize", "claude-haiku-4-5-20251001"),
			makeEvalTask("evaluate", "claude-sonnet-4-6"),
			makeAgentCallTask("analyze", "", "claude-opus-4-6"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 0 {
		t.Errorf("Expected no errors for provider api-id aliases, got: %v", errors)
	}
}

// Suggestions must only surface canonical ids — the documented form — never
// provider api ids, even though api ids are accepted as input.
func TestValidateModelReferences_Suggestions_AreCanonicalOnly(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			// Close to canonical "claude-haiku-4.5" and api id "claude-haiku-4-5-20251001".
			makeLlmCallTask("summarize", "claude-haiku-45"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 1 {
		t.Fatalf("Expected 1 error, got %d: %v", len(errors), errors)
	}

	err := errors[0]
	if !strings.Contains(err, "claude-haiku-4.5") {
		t.Errorf("Expected canonical suggestion 'claude-haiku-4.5', got: %s", err)
	}
	if strings.Contains(err, "claude-haiku-4-5-20251001") {
		t.Errorf("Suggestions must not surface provider api ids, got: %s", err)
	}
}

// The bundled registry is a snapshot of stigmer-cloud's, whose models
// array interleaves `$comment` section-header rows (no id). The shared
// store's indexing must skip them and still populate both harnesses.
func TestModelRegistryIndex_PopulatedFromVerbatimRegistry(t *testing.T) {
	models := registry.Store()
	for _, harness := range []string{harnessNameNative, harnessNameCursor} {
		if !models.HasHarness(harness) {
			t.Errorf("Expected models indexed for harness %q — did the bundled registry parse fail?", harness)
		}
		if len(models.CanonicalModels(harness)) == 0 {
			t.Errorf("Expected canonical suggestion candidates for harness %q", harness)
		}
	}

	// Api-id aliases are valid on top of canonical ids: a canonical id and
	// its provider api id must both resolve (stigmer/stigmer#240).
	if !models.IsValidModel(harnessNameNative, "claude-haiku-4.5") ||
		!models.IsValidModel(harnessNameNative, "claude-haiku-4-5-20251001") {
		t.Error("Expected both the canonical id and its apiModelId alias to validate")
	}
}

func TestValidateModelReferences_ValidCursorModels(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeAgentCallTask("analyze", "cursor", "claude-opus-4-6"),
			makeAgentCallTask("design", "cursor", "composer-2.5"),
			makeAgentCallTask("review", "cursor", "gpt-5.3-codex"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 0 {
		t.Errorf("Expected no errors for valid cursor models, got: %v", errors)
	}
}

func TestValidateModelReferences_InvalidCursorModel_SuggestsClosest(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeAgentCallTask("analyze", "cursor", "claude-opus-4.6"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 1 {
		t.Fatalf("Expected 1 error, got %d: %v", len(errors), errors)
	}

	err := errors[0]
	if !strings.Contains(err, "agent_call") {
		t.Errorf("Expected error to mention 'agent_call', got: %s", err)
	}
	if !strings.Contains(err, "claude-opus-4.6") {
		t.Errorf("Expected error to mention the invalid model 'claude-opus-4.6', got: %s", err)
	}
	if !strings.Contains(err, "harness 'cursor'") {
		t.Errorf("Expected error to mention harness 'cursor', got: %s", err)
	}
	if !strings.Contains(err, "Did you mean") {
		t.Errorf("Expected error to contain suggestions, got: %s", err)
	}
	if !strings.Contains(err, "claude-opus-4-6") {
		t.Errorf("Expected suggestion to include 'claude-opus-4-6', got: %s", err)
	}
}

func TestValidateModelReferences_InvalidNativeModel_SuggestsClosest(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeLlmCallTask("classify", "claude-sonet-4.6"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 1 {
		t.Fatalf("Expected 1 error, got %d: %v", len(errors), errors)
	}

	err := errors[0]
	if !strings.Contains(err, "llm_call") {
		t.Errorf("Expected error to mention 'llm_call', got: %s", err)
	}
	if !strings.Contains(err, "harness 'native'") {
		t.Errorf("Expected error to mention harness 'native', got: %s", err)
	}
	if !strings.Contains(err, "claude-sonnet-4.6") {
		t.Errorf("Expected suggestion to include 'claude-sonnet-4.6', got: %s", err)
	}
}

func TestValidateModelReferences_AgentCallOptionalModel_NoError(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeAgentCallTask("analyze", "cursor", ""),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 0 {
		t.Errorf("Expected no errors when agent_call model is empty, got: %v", errors)
	}
}

func TestValidateModelReferences_AgentCallNoConfig_NoError(t *testing.T) {
	config := map[string]interface{}{
		"agent":   "test-agent",
		"message": "test message",
		"harness": "cursor",
	}
	cfg, _ := structpb.NewStruct(config)
	task := &workflowv1.WorkflowTask{
		Name:       "analyze",
		Kind:       workflowv1.WorkflowTaskKind_agent_call,
		TaskConfig: cfg,
	}

	spec := &workflowv1.WorkflowSpec{Tasks: []*workflowv1.WorkflowTask{task}}
	errors := ValidateModelReferences(spec)
	if len(errors) != 0 {
		t.Errorf("Expected no errors when agent_call has no config block, got: %v", errors)
	}
}

func TestValidateModelReferences_CrossHarnessMismatch(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeAgentCallTask("analyze", "cursor", "claude-sonnet-4.6"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 1 {
		t.Fatalf("Expected 1 error for cross-harness mismatch, got %d: %v", len(errors), errors)
	}

	err := errors[0]
	if !strings.Contains(err, "harness 'cursor'") {
		t.Errorf("Expected error to reference cursor harness, got: %s", err)
	}
	if !strings.Contains(err, "Did you mean") {
		t.Errorf("Expected suggestions for cursor models, got: %s", err)
	}
}

func TestValidateModelReferences_DefaultHarnessIsNative(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeAgentCallTask("analyze", "", "claude-sonnet-4.6"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 0 {
		t.Errorf("Expected no errors when default harness resolves to native with native model, got: %v", errors)
	}
}

func TestValidateModelReferences_FarTypo_NoSuggestions(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeLlmCallTask("classify", "zzzzzzzzzzzzzzz"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 1 {
		t.Fatalf("Expected 1 error, got %d: %v", len(errors), errors)
	}

	err := errors[0]
	if strings.Contains(err, "Did you mean") {
		t.Errorf("Expected no suggestions for distant model name, got: %s", err)
	}
}

func TestValidateModelReferences_EvalInvalidModel(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeEvalTask("check", "gpt-4oo"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 1 {
		t.Fatalf("Expected 1 error for invalid eval model, got %d: %v", len(errors), errors)
	}

	err := errors[0]
	if !strings.Contains(err, "eval") {
		t.Errorf("Expected error to mention 'eval', got: %s", err)
	}
	if !strings.Contains(err, "gpt-4o") {
		t.Errorf("Expected suggestion 'gpt-4o' for typo 'gpt-4oo', got: %s", err)
	}
}

func TestValidateModelReferences_MultipleErrors(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeLlmCallTask("step1", "invalid-model-1"),
			makeAgentCallTask("step2", "cursor", "invalid-model-2"),
		},
	}

	errors := ValidateModelReferences(spec)
	if len(errors) != 2 {
		t.Fatalf("Expected 2 errors, got %d: %v", len(errors), errors)
	}
}

func TestValidateModelReferences_NilSpec(t *testing.T) {
	errors := ValidateModelReferences(nil)
	if len(errors) != 0 {
		t.Errorf("Expected no errors for nil spec, got: %v", errors)
	}
}

func TestValidateModelReferences_EmptyTasks(t *testing.T) {
	spec := &workflowv1.WorkflowSpec{Tasks: []*workflowv1.WorkflowTask{}}
	errors := ValidateModelReferences(spec)
	if len(errors) != 0 {
		t.Errorf("Expected no errors for empty tasks, got: %v", errors)
	}
}

func TestSuggestSimilarModels_SortedByDistance(t *testing.T) {
	candidates := []string{"aaa", "aab", "abc", "xyz"}
	result := suggestSimilarModels("aaa", candidates)

	if len(result) == 0 {
		t.Fatal("Expected at least one suggestion")
	}
	if result[0] != "aaa" {
		t.Errorf("Expected exact match 'aaa' first, got: %s", result[0])
	}
}

func TestSuggestSimilarModels_MaxThree(t *testing.T) {
	candidates := []string{"a", "aa", "ab", "ac", "ad"}
	result := suggestSimilarModels("a", candidates)

	if len(result) > maxModelSuggestions {
		t.Errorf("Expected at most %d suggestions, got %d", maxModelSuggestions, len(result))
	}
}

func TestSuggestSimilarModels_EmptyCandidates(t *testing.T) {
	result := suggestSimilarModels("anything", nil)
	if len(result) != 0 {
		t.Errorf("Expected no suggestions for empty candidates, got: %v", result)
	}
}
