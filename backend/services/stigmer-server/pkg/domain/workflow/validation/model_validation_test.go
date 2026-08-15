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
		config["run_config"] = map[string]interface{}{
			"model_name": model,
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

func makeAgentCallTaskWithTier(name, harness, model, serviceTier string) *workflowv1.WorkflowTask {
	return makeAgentCallTaskWithVariants(name, harness, model, serviceTier, "")
}

func makeAgentCallTaskWithVariants(name, harness, model, serviceTier, thinkingMode string) *workflowv1.WorkflowTask {
	config := map[string]interface{}{
		"agent":   "test-agent",
		"message": "test message",
	}
	runConfig := map[string]interface{}{}
	if model != "" {
		runConfig["model_name"] = model
	}
	if serviceTier != "" {
		runConfig["service_tier"] = serviceTier
	}
	if thinkingMode != "" {
		runConfig["thinking_mode"] = thinkingMode
	}
	if len(runConfig) > 0 {
		config["run_config"] = runConfig
	}
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
			makeLlmCallTask("summarize", "claude-haiku-4.5"),
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

// Service-tier rules at the workflow surface (stigmer/stigmer#357): the same
// fail-closed posture as execution create — FAST needs a pinned model that
// prices a fast variant — plus the harness dimension the workflow surface
// has and execution create does not: the fast variant must be priced FOR
// THE TASK'S HARNESS. STANDARD/unset is always valid.
func TestValidateModelReferences_ServiceTier(t *testing.T) {
	tests := []struct {
		name         string
		task         *workflowv1.WorkflowTask
		wantErrors   int
		wantContains string
	}{
		{
			name:       "FAST with a fast-priced model passes",
			task:       makeAgentCallTaskWithTier("triage", "cursor", "composer-2.5", "fast"),
			wantErrors: 0,
		},
		{
			name:       "explicit standard passes without a model",
			task:       makeAgentCallTaskWithTier("triage", "cursor", "", "standard"),
			wantErrors: 0,
		},
		{
			name:         "FAST without model_name fails closed",
			task:         makeAgentCallTaskWithTier("triage", "cursor", "", "fast"),
			wantErrors:   1,
			wantContains: "requires run_config.model_name",
		},
		{
			name:         "FAST on a model with no fast variant fails closed",
			task:         makeAgentCallTaskWithTier("triage", "native", "claude-sonnet-4.6", "fast"),
			wantErrors:   1,
			wantContains: "prices no fast variant",
		},
		{
			// composer-2.5 prices a fast variant — but under the cursor
			// harness. A native agent_call must not validate it: the native
			// path can never apply the tier (silent-no-op leak). The second
			// error is the ordinary model-for-harness refusal.
			name:         "FAST priced only under another harness fails closed",
			task:         makeAgentCallTaskWithTier("triage", "native", "composer-2.5", "fast"),
			wantErrors:   2,
			wantContains: "on harness 'native'",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spec := &workflowv1.WorkflowSpec{Tasks: []*workflowv1.WorkflowTask{tt.task}}
			errors := ValidateModelReferences(spec)
			if len(errors) != tt.wantErrors {
				t.Fatalf("expected %d errors, got %d: %v", tt.wantErrors, len(errors), errors)
			}
			if tt.wantContains != "" && !strings.Contains(errors[0], tt.wantContains) {
				t.Errorf("expected error to contain %q, got: %s", tt.wantContains, errors[0])
			}
		})
	}
}

// Fail-closed thinking-mode validation for agent_call run_config
// (stigmer/stigmer#772) — capability-gated and harness-scoped, the twin of
// the service-tier cases above. Bundle facts: claude-opus-4-6 declares
// capabilities.thinking under cursor; composer-2.5 declares thinking=false;
// claude-sonnet-4.6 declares it under native only (no thinking wire
// mapping in v1 — refused with the ordinary model-for-harness rules).
func TestValidateModelReferences_ThinkingMode(t *testing.T) {
	tests := []struct {
		name         string
		task         *workflowv1.WorkflowTask
		wantErrors   int
		wantContains string
	}{
		{
			name:       "ENABLED with a thinking-capable cursor model passes",
			task:       makeAgentCallTaskWithVariants("triage", "cursor", "claude-opus-4-6", "", "enabled"),
			wantErrors: 0,
		},
		{
			name:       "ENABLED combines freely with FAST on a capable model",
			task:       makeAgentCallTaskWithVariants("triage", "cursor", "claude-opus-4-6", "fast", "enabled"),
			wantErrors: 0,
		},
		{
			// Case-insensitive shorthand normalization (the #357 "Fast"
			// fail-open lesson): a capitalized shorthand must normalize and
			// then validate — never validate one thing and execute another.
			name:         "capitalized shorthand normalizes before validating",
			task:         makeAgentCallTaskWithVariants("triage", "cursor", "composer-2.5", "", "Enabled"),
			wantErrors:   1,
			wantContains: "declares no thinking capability",
		},
		{
			name:       "explicit disabled passes without a model",
			task:       makeAgentCallTaskWithVariants("triage", "cursor", "", "", "disabled"),
			wantErrors: 0,
		},
		{
			name:         "ENABLED without model_name fails closed",
			task:         makeAgentCallTaskWithVariants("triage", "cursor", "", "", "enabled"),
			wantErrors:   1,
			wantContains: "requires run_config.model_name",
		},
		{
			name:         "ENABLED on a model without the capability fails closed",
			task:         makeAgentCallTaskWithVariants("triage", "cursor", "composer-2.5", "", "enabled"),
			wantErrors:   1,
			wantContains: "declares no thinking capability",
		},
		{
			// claude-sonnet-4.6 declares thinking — but under the native
			// harness. A cursor agent_call must not validate it: the second
			// error is the ordinary model-for-harness refusal.
			name:         "capability declared only under another harness fails closed",
			task:         makeAgentCallTaskWithVariants("triage", "cursor", "claude-sonnet-4.6", "", "enabled"),
			wantErrors:   2,
			wantContains: "on harness 'cursor'",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spec := &workflowv1.WorkflowSpec{Tasks: []*workflowv1.WorkflowTask{tt.task}}
			errors := ValidateModelReferences(spec)
			if len(errors) != tt.wantErrors {
				t.Fatalf("expected %d errors, got %d: %v", tt.wantErrors, len(errors), errors)
			}
			if tt.wantContains != "" && !strings.Contains(errors[0], tt.wantContains) {
				t.Errorf("expected error to contain %q, got: %s", tt.wantContains, errors[0])
			}
		})
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
			makeEvalTask("check", "claude-opus-46"),
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
	if !strings.Contains(err, "claude-opus-4.6") {
		t.Errorf("Expected suggestion 'claude-opus-4.6' for typo 'claude-opus-46', got: %s", err)
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

// The suggestion machinery itself (ordering, the three-suggestion cap,
// empty candidates) is tested where it now lives: the registry package's
// pin_validation_test.go (SuggestSimilarModels moved there so workflow and
// schedule/channel pin errors suggest identically, stigmer/stigmer#774).
