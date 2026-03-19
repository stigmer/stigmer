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

func makeEnv(data map[string]*environmentv1.EnvironmentValue) *environmentv1.Environment {
	return &environmentv1.Environment{
		Spec: &environmentv1.EnvironmentSpec{Data: data},
	}
}

// --- MergeEnvironmentLayers tests ---

func TestMergeEnvironmentLayers(t *testing.T) {
	tests := []struct {
		name         string
		templateData map[string]*environmentv1.EnvironmentValue
		environments []*environmentv1.Environment
		runtimeEnv   map[string]*executioncontextv1.ExecutionValue
		wantKeys     map[string]*executioncontextv1.ExecutionValue
	}{
		{
			name:     "all nil inputs returns empty map",
			wantKeys: map[string]*executioncontextv1.ExecutionValue{},
		},
		{
			name: "template defaults only",
			templateData: map[string]*environmentv1.EnvironmentValue{
				"API_KEY": envVal("key-123", true),
				"REGION":  envVal("us-east-1", false),
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"API_KEY": execVal("key-123", true),
				"REGION":  execVal("us-east-1", false),
			},
		},
		{
			name: "template entries with empty values are skipped",
			templateData: map[string]*environmentv1.EnvironmentValue{
				"HAS_VALUE":    envVal("present", false),
				"SCHEMA_ONLY":  envVal("", false),
				"SCHEMA_SECRET": envVal("", true),
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"HAS_VALUE": execVal("present", false),
			},
		},
		{
			name: "nil template entries are skipped",
			templateData: map[string]*environmentv1.EnvironmentValue{
				"GOOD": envVal("ok", false),
				"NIL":  nil,
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"GOOD": execVal("ok", false),
			},
		},
		{
			name: "environment layer overrides template",
			templateData: map[string]*environmentv1.EnvironmentValue{
				"SHARED": envVal("from-template", false),
			},
			environments: []*environmentv1.Environment{
				makeEnv(map[string]*environmentv1.EnvironmentValue{
					"SHARED": envVal("from-env", false),
				}),
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"SHARED": execVal("from-env", false),
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
			name: "runtime_env overrides all lower layers",
			templateData: map[string]*environmentv1.EnvironmentValue{
				"SHARED": envVal("template", false),
			},
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
			name: "full priority chain — template < env < runtime",
			templateData: map[string]*environmentv1.EnvironmentValue{
				"TEMPLATE_ONLY":   envVal("from-template", false),
				"TEMPLATE_AND_ENV": envVal("t-val", false),
				"ALL_THREE":       envVal("t-val", false),
			},
			environments: []*environmentv1.Environment{
				makeEnv(map[string]*environmentv1.EnvironmentValue{
					"TEMPLATE_AND_ENV": envVal("e-val", false),
					"ALL_THREE":        envVal("e-val", false),
					"ENV_ONLY":         envVal("from-env", false),
				}),
			},
			runtimeEnv: map[string]*executioncontextv1.ExecutionValue{
				"ALL_THREE":    execVal("r-val", false),
				"RUNTIME_ONLY": execVal("from-runtime", false),
			},
			wantKeys: map[string]*executioncontextv1.ExecutionValue{
				"TEMPLATE_ONLY":   execVal("from-template", false),
				"TEMPLATE_AND_ENV": execVal("e-val", false),
				"ALL_THREE":       execVal("r-val", false),
				"ENV_ONLY":        execVal("from-env", false),
				"RUNTIME_ONLY":    execVal("from-runtime", false),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MergeEnvironmentLayers(tt.templateData, tt.environments, tt.runtimeEnv)

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

// --- FilterByEnvSpec tests ---

func TestFilterByEnvSpec(t *testing.T) {
	tests := []struct {
		name             string
		merged           map[string]*executioncontextv1.ExecutionValue
		envSpecData      map[string]*environmentv1.EnvironmentValue
		wantFilteredKeys []string
		wantExcluded     []string
	}{
		{
			name:             "nil envSpecData passes all through",
			merged:           map[string]*executioncontextv1.ExecutionValue{"A": execVal("a", false), "B": execVal("b", false)},
			envSpecData:      nil,
			wantFilteredKeys: []string{"A", "B"},
			wantExcluded:     nil,
		},
		{
			name:             "empty envSpecData passes all through",
			merged:           map[string]*executioncontextv1.ExecutionValue{"A": execVal("a", false)},
			envSpecData:      map[string]*environmentv1.EnvironmentValue{},
			wantFilteredKeys: []string{"A"},
			wantExcluded:     nil,
		},
		{
			name: "only declared vars pass through",
			merged: map[string]*executioncontextv1.ExecutionValue{
				"DECLARED":   execVal("val", false),
				"UNDECLARED": execVal("secret", true),
			},
			envSpecData: map[string]*environmentv1.EnvironmentValue{
				"DECLARED": envVal("", false),
			},
			wantFilteredKeys: []string{"DECLARED"},
			wantExcluded:     []string{"UNDECLARED"},
		},
		{
			name: "env_spec with empty-value entries still allows those keys",
			merged: map[string]*executioncontextv1.ExecutionValue{
				"GITHUB_TOKEN": execVal("ghp_abc123", true),
				"EXTRA":        execVal("not-needed", false),
			},
			envSpecData: map[string]*environmentv1.EnvironmentValue{
				"GITHUB_TOKEN": envVal("", true),
			},
			wantFilteredKeys: []string{"GITHUB_TOKEN"},
			wantExcluded:     []string{"EXTRA"},
		},
		{
			name: "all merged keys in env_spec — no exclusion",
			merged: map[string]*executioncontextv1.ExecutionValue{
				"A": execVal("a", false),
				"B": execVal("b", false),
			},
			envSpecData: map[string]*environmentv1.EnvironmentValue{
				"A": envVal("default-a", false),
				"B": envVal("", false),
				"C": envVal("", false),
			},
			wantFilteredKeys: []string{"A", "B"},
			wantExcluded:     []string{},
		},
		{
			name: "excluded keys are sorted alphabetically",
			merged: map[string]*executioncontextv1.ExecutionValue{
				"ZEBRA":  execVal("z", false),
				"APPLE":  execVal("a", false),
				"MANGO":  execVal("m", false),
				"KEEP":   execVal("k", false),
			},
			envSpecData: map[string]*environmentv1.EnvironmentValue{
				"KEEP": envVal("", false),
			},
			wantFilteredKeys: []string{"KEEP"},
			wantExcluded:     []string{"APPLE", "MANGO", "ZEBRA"},
		},
		{
			name:             "empty merged map returns empty",
			merged:           map[string]*executioncontextv1.ExecutionValue{},
			envSpecData:      map[string]*environmentv1.EnvironmentValue{"A": envVal("", false)},
			wantFilteredKeys: []string{},
			wantExcluded:     []string{},
		},
		{
			name: "runtime overrides for undeclared vars are excluded",
			merged: map[string]*executioncontextv1.ExecutionValue{
				"DECLARED":       execVal("from-runtime", false),
				"RUNTIME_EXTRA":  execVal("injected", true),
			},
			envSpecData: map[string]*environmentv1.EnvironmentValue{
				"DECLARED": envVal("default", false),
			},
			wantFilteredKeys: []string{"DECLARED"},
			wantExcluded:     []string{"RUNTIME_EXTRA"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filtered, excludedKeys := FilterByEnvSpec(tt.merged, tt.envSpecData)

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

// TestFilterByEnvSpec_ReturnsSameMapWhenNoEnvSpec verifies that the returned map
// is the exact same reference (not a copy) when env_spec is nil/empty.
func TestFilterByEnvSpec_ReturnsSameMapWhenNoEnvSpec(t *testing.T) {
	original := map[string]*executioncontextv1.ExecutionValue{
		"KEY": execVal("val", false),
	}

	filtered, excluded := FilterByEnvSpec(original, nil)
	if excluded != nil {
		t.Errorf("expected nil excludedKeys for nil envSpecData")
	}

	original["NEW_KEY"] = execVal("new", false)
	if _, ok := filtered["NEW_KEY"]; !ok {
		t.Error("expected filtered to be the same map reference as original when envSpecData is nil")
	}
}
