package envmerge

import (
	"testing"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
)

// --- helpers ---

func envVal(value string, isSecret bool) *environmentv1.EnvironmentValue {
	return &environmentv1.EnvironmentValue{Value: value, IsSecret: isSecret}
}

func execVal(value string, isSecret bool) *executioncontextv1.ExecutionValue {
	return &executioncontextv1.ExecutionValue{Value: value, IsSecret: isSecret}
}

func decl(isSecret bool) *environmentv1.EnvVarDeclaration {
	return &environmentv1.EnvVarDeclaration{IsSecret: isSecret}
}

func makeEnv(data map[string]*environmentv1.EnvironmentValue) *environmentv1.Environment {
	return &environmentv1.Environment{
		Spec: &environmentv1.EnvironmentSpec{Data: data},
	}
}

// --- MergeEnvironmentLayers tests ---

func TestMergeEnvironmentLayers(t *testing.T) {
	tests := []struct {
		name         string
		environments []*environmentv1.Environment
		runtimeEnv   map[string]*executioncontextv1.ExecutionValue
		wantKeys     map[string]*executioncontextv1.ExecutionValue
	}{
		{
			name:     "all nil inputs returns empty map",
			wantKeys: map[string]*executioncontextv1.ExecutionValue{},
		},
		{
			name: "single environment",
			environments: []*environmentv1.Environment{
				makeEnv(map[string]*environmentv1.EnvironmentValue{
					"API_KEY": envVal("key-123", true),
					"REGION":  envVal("us-east-1", false),
				}),
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"API_KEY": execVal("key-123", true),
				"REGION":  execVal("us-east-1", false),
			},
		},
		{
			name: "multiple environments merge in order — later wins",
			environments: []*environmentv1.Environment{
				makeEnv(map[string]*environmentv1.EnvironmentValue{
					"KEY1":   envVal("env1-val", false),
					"SHARED": envVal("from-env1", false),
				}),
				makeEnv(map[string]*environmentv1.EnvironmentValue{
					"KEY2":   envVal("env2-val", false),
					"SHARED": envVal("from-env2", false),
				}),
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"KEY1":   execVal("env1-val", false),
				"KEY2":   execVal("env2-val", false),
				"SHARED": execVal("from-env2", false),
			},
		},
		{
			name: "nil environments in slice are skipped",
			environments: []*environmentv1.Environment{
				nil,
				makeEnv(map[string]*environmentv1.EnvironmentValue{
					"KEY": envVal("val", false),
				}),
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"KEY": execVal("val", false),
			},
		},
		{
			name: "environment entries with empty values are skipped",
			environments: []*environmentv1.Environment{
				makeEnv(map[string]*environmentv1.EnvironmentValue{
					"FILLED": envVal("value", false),
					"EMPTY":  envVal("", false),
				}),
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"FILLED": execVal("value", false),
			},
		},
		{
			name: "runtime_env overrides environments",
			environments: []*environmentv1.Environment{
				makeEnv(map[string]*environmentv1.EnvironmentValue{
					"SHARED": envVal("env", false),
				}),
			},
			runtimeEnv: map[string]*executioncontextv1.ExecutionValue{
				"SHARED": execVal("runtime", true),
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"SHARED": execVal("runtime", true),
			},
		},
		{
			name: "nil runtime_env entries are skipped",
			runtimeEnv: map[string]*executioncontextv1.ExecutionValue{
				"GOOD": execVal("ok", false),
				"NIL":  nil,
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"GOOD": execVal("ok", false),
			},
		},
		{
			name: "full priority chain — env < runtime",
			environments: []*environmentv1.Environment{
				makeEnv(map[string]*environmentv1.EnvironmentValue{
					"ENV_AND_RUNTIME": envVal("e-val", false),
					"ENV_ONLY":        envVal("from-env", false),
					"BOTH":            envVal("e-val", false),
				}),
			},
			runtimeEnv: map[string]*executioncontextv1.ExecutionValue{
				"BOTH":         execVal("r-val", false),
				"RUNTIME_ONLY": execVal("from-runtime", false),
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"ENV_AND_RUNTIME": execVal("e-val", false),
				"BOTH":            execVal("r-val", false),
				"ENV_ONLY":        execVal("from-env", false),
				"RUNTIME_ONLY":    execVal("from-runtime", false),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MergeEnvironmentLayers(tt.environments, tt.runtimeEnv)

			if len(got) != len(tt.wantKeys) {
				t.Fatalf("got %d entries, want %d", len(got), len(tt.wantKeys))
			}
			for key, wantVal := range tt.wantKeys {
				gotVal, ok := got[key]
				if !ok {
					t.Errorf("missing key %q", key)
					continue
				}
				if gotVal.GetValue() != wantVal.GetValue() {
					t.Errorf("key %q: got value %q, want %q", key, gotVal.GetValue(), wantVal.GetValue())
				}
				if gotVal.GetIsSecret() != wantVal.GetIsSecret() {
					t.Errorf("key %q: got isSecret %v, want %v", key, gotVal.GetIsSecret(), wantVal.GetIsSecret())
				}
			}
		})
	}
}

// --- FilterByDeclaredKeys tests ---

func TestFilterByDeclaredKeys(t *testing.T) {
	tests := []struct {
		name             string
		merged           map[string]*executioncontextv1.ExecutionValue
		declarations     map[string]*environmentv1.EnvVarDeclaration
		wantFilteredKeys []string
		wantExcluded     []string
	}{
		{
			name:             "nil declarations passes all through",
			merged:           map[string]*executioncontextv1.ExecutionValue{"A": execVal("a", false), "B": execVal("b", false)},
			declarations:     nil,
			wantFilteredKeys: []string{"A", "B"},
			wantExcluded:     nil,
		},
		{
			name:             "empty declarations passes all through",
			merged:           map[string]*executioncontextv1.ExecutionValue{"A": execVal("a", false)},
			declarations:     map[string]*environmentv1.EnvVarDeclaration{},
			wantFilteredKeys: []string{"A"},
			wantExcluded:     nil,
		},
		{
			name: "only declared vars pass through",
			merged: map[string]*executioncontextv1.ExecutionValue{
				"DECLARED":   execVal("val", false),
				"UNDECLARED": execVal("secret", true),
			},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"DECLARED": decl(false),
			},
			wantFilteredKeys: []string{"DECLARED"},
			wantExcluded:     []string{"UNDECLARED"},
		},
		{
			name: "secret declarations allow those keys",
			merged: map[string]*executioncontextv1.ExecutionValue{
				"GITHUB_TOKEN": execVal("ghp_abc123", true),
				"EXTRA":        execVal("not-needed", false),
			},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"GITHUB_TOKEN": decl(true),
			},
			wantFilteredKeys: []string{"GITHUB_TOKEN"},
			wantExcluded:     []string{"EXTRA"},
		},
		{
			name: "all merged keys in declarations — no exclusion",
			merged: map[string]*executioncontextv1.ExecutionValue{
				"A": execVal("a", false),
				"B": execVal("b", false),
			},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"A": decl(false),
				"B": decl(false),
				"C": decl(false),
			},
			wantFilteredKeys: []string{"A", "B"},
			wantExcluded:     []string{},
		},
		{
			name: "excluded keys are sorted alphabetically",
			merged: map[string]*executioncontextv1.ExecutionValue{
				"ZEBRA": execVal("z", false),
				"APPLE": execVal("a", false),
				"MANGO": execVal("m", false),
				"KEEP":  execVal("k", false),
			},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"KEEP": decl(false),
			},
			wantFilteredKeys: []string{"KEEP"},
			wantExcluded:     []string{"APPLE", "MANGO", "ZEBRA"},
		},
		{
			name:             "empty merged map returns empty",
			merged:           map[string]*executioncontextv1.ExecutionValue{},
			declarations:     map[string]*environmentv1.EnvVarDeclaration{"A": decl(false)},
			wantFilteredKeys: []string{},
			wantExcluded:     []string{},
		},
		{
			name: "runtime overrides for undeclared vars are excluded",
			merged: map[string]*executioncontextv1.ExecutionValue{
				"DECLARED":      execVal("from-runtime", false),
				"RUNTIME_EXTRA": execVal("injected", true),
			},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"DECLARED": decl(false),
			},
			wantFilteredKeys: []string{"DECLARED"},
			wantExcluded:     []string{"RUNTIME_EXTRA"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filtered, excludedKeys := FilterByDeclaredKeys(tt.merged, tt.declarations)

			if len(filtered) != len(tt.wantFilteredKeys) {
				t.Fatalf("filtered: got %d entries, want %d", len(filtered), len(tt.wantFilteredKeys))
			}
			for _, key := range tt.wantFilteredKeys {
				if _, ok := filtered[key]; !ok {
					t.Errorf("expected key %q in filtered map", key)
				}
			}

			if tt.wantExcluded == nil {
				if excludedKeys != nil {
					t.Errorf("expected nil excludedKeys, got %v", excludedKeys)
				}
			} else {
				if len(excludedKeys) != len(tt.wantExcluded) {
					t.Fatalf("excludedKeys: got %v, want %v", excludedKeys, tt.wantExcluded)
				}
				for i, key := range tt.wantExcluded {
					if excludedKeys[i] != key {
						t.Errorf("excludedKeys[%d]: got %q, want %q", i, excludedKeys[i], key)
					}
				}
			}
		})
	}
}

// --- ValidateRequiredKeys tests ---

func TestValidateRequiredKeys(t *testing.T) {
	optionalDecl := func(isSecret, optional bool) *environmentv1.EnvVarDeclaration {
		return &environmentv1.EnvVarDeclaration{IsSecret: isSecret, Optional: optional}
	}

	tests := []struct {
		name         string
		filtered     map[string]*executioncontextv1.ExecutionValue
		declarations map[string]*environmentv1.EnvVarDeclaration
		wantMissing  []string
	}{
		{
			name:         "nil declarations — nothing required",
			filtered:     map[string]*executioncontextv1.ExecutionValue{"A": execVal("a", false)},
			declarations: nil,
			wantMissing:  nil,
		},
		{
			name:         "empty declarations — nothing required",
			filtered:     map[string]*executioncontextv1.ExecutionValue{},
			declarations: map[string]*environmentv1.EnvVarDeclaration{},
			wantMissing:  nil,
		},
		{
			name:     "all required keys present — valid",
			filtered: map[string]*executioncontextv1.ExecutionValue{"API_KEY": execVal("k", true)},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"API_KEY": optionalDecl(true, false),
			},
			wantMissing: nil,
		},
		{
			name:     "required key missing — reported",
			filtered: map[string]*executioncontextv1.ExecutionValue{},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"API_KEY": optionalDecl(true, false),
			},
			wantMissing: []string{"API_KEY"},
		},
		{
			name:     "optional key missing — not reported",
			filtered: map[string]*executioncontextv1.ExecutionValue{},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"LOG_LEVEL": optionalDecl(false, true),
			},
			wantMissing: nil,
		},
		{
			name:     "mix of required present, required missing, optional missing",
			filtered: map[string]*executioncontextv1.ExecutionValue{"PRESENT": execVal("v", false)},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"PRESENT":          optionalDecl(false, false),
				"MISSING_REQUIRED": optionalDecl(true, false),
				"MISSING_OPTIONAL": optionalDecl(false, true),
			},
			wantMissing: []string{"MISSING_REQUIRED"},
		},
		{
			name:     "multiple missing required keys — sorted alphabetically",
			filtered: map[string]*executioncontextv1.ExecutionValue{},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"ZEBRA_KEY": optionalDecl(false, false),
				"ALPHA_KEY": optionalDecl(true, false),
				"MIDDLE":    optionalDecl(false, false),
			},
			wantMissing: []string{"ALPHA_KEY", "MIDDLE", "ZEBRA_KEY"},
		},
		{
			name:     "all optional — nothing required",
			filtered: map[string]*executioncontextv1.ExecutionValue{},
			declarations: map[string]*environmentv1.EnvVarDeclaration{
				"OPT_A": optionalDecl(false, true),
				"OPT_B": optionalDecl(true, true),
			},
			wantMissing: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ValidateRequiredKeys(tt.filtered, tt.declarations)

			if tt.wantMissing == nil {
				if len(got) != 0 {
					t.Errorf("expected no missing keys, got %v", got)
				}
				return
			}
			if len(got) != len(tt.wantMissing) {
				t.Fatalf("got %v, want %v", got, tt.wantMissing)
			}
			for i, key := range tt.wantMissing {
				if got[i] != key {
					t.Errorf("missing[%d]: got %q, want %q", i, got[i], key)
				}
			}
		})
	}
}

// TestFilterByDeclaredKeys_ReturnsSameMapWhenNoDeclarations verifies that the
// returned map is the exact same reference (not a copy) when declarations is nil/empty.
func TestFilterByDeclaredKeys_ReturnsSameMapWhenNoDeclarations(t *testing.T) {
	original := map[string]*executioncontextv1.ExecutionValue{
		"KEY": execVal("val", false),
	}

	filtered, excluded := FilterByDeclaredKeys(original, nil)
	if excluded != nil {
		t.Errorf("expected nil excludedKeys for nil declarations")
	}

	original["NEW_KEY"] = execVal("new", false)
	if _, ok := filtered["NEW_KEY"]; !ok {
		t.Error("expected filtered to be the same map reference as original when declarations is nil")
	}
}
