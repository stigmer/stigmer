package registry

import (
	"strings"
	"testing"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
)

// These tests run against the bundled registry (the same document the
// singleton Store() loads), so they pin the rule's behavior on the real
// model catalog — including the issue's own motivating example: the
// 'composr-2.5' typo that used to silently bill at Auto rates
// (stigmer/stigmer#774).

func TestUnknownModelPinRefusal_ValidPinsPass(t *testing.T) {
	cases := []struct {
		name    string
		harness string
		model   string
	}{
		{"valid cursor pin", HarnessNameCursor, "composer-2.5"},
		{"valid native pin", HarnessNameNative, "claude-sonnet-4.6"},
		{"provider api id alias", HarnessNameNative, "claude-haiku-4-5-20251001"},
		{"any-harness mode accepts a model valid anywhere", "", "claude-sonnet-4.6"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := UnknownModelPinRefusal("spec.run_config.model_name", tc.harness, tc.model); got != "" {
				t.Errorf("expected no refusal, got: %s", got)
			}
		})
	}
}

func TestUnknownModelPinRefusal_TypoRefusedWithSuggestion(t *testing.T) {
	got := UnknownModelPinRefusal(
		"spec.agent.run_config.model_name", HarnessNameCursor, "composr-2.5")
	if got == "" {
		t.Fatal("expected a refusal for the typo'd pin")
	}
	if !strings.Contains(got, "spec.agent.run_config.model_name") {
		t.Errorf("refusal must name the field path, got: %s", got)
	}
	if !strings.Contains(got, "not in the model registry (cursor harness)") {
		t.Errorf("refusal must name the harness scope, got: %s", got)
	}
	if !strings.Contains(got, "'composer-2.5'") {
		t.Errorf("expected the did-you-mean suggestion 'composer-2.5', got: %s", got)
	}
}

func TestUnknownModelPinRefusal_AnyHarnessMode(t *testing.T) {
	// A pin no harness section knows is certainly a typo.
	got := UnknownModelPinRefusal("spec.run_config.model_name", "", "composr-2.5")
	if got == "" {
		t.Fatal("expected a refusal for a pin unknown to every harness")
	}
	if !strings.Contains(got, "not in the model registry (any harness)") {
		t.Errorf("any-harness refusals must say so, got: %s", got)
	}
	if !strings.Contains(got, "'composer-2.5'") {
		t.Errorf("expected a cross-harness suggestion, got: %s", got)
	}
}

func TestUnknownModelPinRefusal_DegradesToNoop(t *testing.T) {
	// An empty pin is not this rule's concern (presence is #362's rule).
	if got := UnknownModelPinRefusal("f", HarnessNameCursor, ""); got != "" {
		t.Errorf("an empty pin must pass, got: %s", got)
	}
	if got := UnknownModelPinRefusal("f", HarnessNameCursor, "   "); got != "" {
		t.Errorf("a whitespace pin must pass, got: %s", got)
	}
	// A harness section the registry does not know cannot be validated
	// against — degrade rather than refuse everything (the HasAnyModels
	// posture; an air-gapped or stale registry must not lock users out).
	if got := UnknownModelPinRefusal("f", "no-such-harness", "anything"); got != "" {
		t.Errorf("an unknown harness section must degrade to a no-op, got: %s", got)
	}
}

func TestHarnessName_EditionDefaultIsNative(t *testing.T) {
	if got := HarnessName(sessionv1.Harness_HARNESS_CURSOR); got != HarnessNameCursor {
		t.Errorf("explicit cursor must map to %q, got %q", HarnessNameCursor, got)
	}
	// Unset resolves to native — this edition's platform default (DD-015):
	// an unset-harness schedule RUNS native here, so its pin must validate
	// against the native section.
	if got := HarnessName(sessionv1.Harness_HARNESS_UNSPECIFIED); got != HarnessNameNative {
		t.Errorf("unset harness must map to %q, got %q", HarnessNameNative, got)
	}
}

func TestSuggestSimilarModels_CapsAndOrders(t *testing.T) {
	candidates := []string{"composer-2.5", "composer-2.0", "gpt-5.3-codex", "zzz-unrelated"}
	got := SuggestSimilarModels("composr-2.5", candidates)
	if len(got) == 0 || got[0] != "composer-2.5" {
		t.Fatalf("closest candidate must come first, got: %v", got)
	}
	for _, s := range got {
		if s == "zzz-unrelated" {
			t.Errorf("far-off candidates must not be suggested, got: %v", got)
		}
	}
	if far := SuggestSimilarModels("completely-different-name-entirely", candidates); len(far) != 0 {
		t.Errorf("a far-off typo gets no misleading suggestion, got: %v", far)
	}
}

func TestSuggestSimilarModels_MaxThreeAndEmptyCandidates(t *testing.T) {
	if got := SuggestSimilarModels("a", []string{"a", "aa", "ab", "ac", "ad"}); len(got) > maxModelSuggestions {
		t.Errorf("expected at most %d suggestions, got %d", maxModelSuggestions, len(got))
	}
	if got := SuggestSimilarModels("anything", nil); len(got) != 0 {
		t.Errorf("expected no suggestions for empty candidates, got: %v", got)
	}
}
