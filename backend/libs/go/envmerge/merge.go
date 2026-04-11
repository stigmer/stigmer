package envmerge

import (
	"sort"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
)

// MergeEnvironmentLayers merges two layers of environment configuration into
// a single map of ExecutionValue entries, suitable for persisting in an
// ExecutionContext.
//
// Merge priority (lowest to highest):
//  1. environments  -- resolved Environment resources from instance environment_refs/env_refs (in order)
//  2. runtimeEnv    -- execution-scoped runtime_env overrides (highest priority)
func MergeEnvironmentLayers(
	environments []*environmentv1.Environment,
	runtimeEnv map[string]*executioncontextv1.ExecutionValue,
) map[string]*executioncontextv1.ExecutionValue {
	merged := make(map[string]*executioncontextv1.ExecutionValue)

	// Layer 1: environments (in order; later overrides earlier)
	for _, env := range environments {
		if env == nil {
			continue
		}
		for key, ev := range env.GetSpec().GetData() {
			if ev == nil || ev.GetValue() == "" {
				continue
			}
			merged[key] = &executioncontextv1.ExecutionValue{
				Value:    ev.GetValue(),
				IsSecret: ev.GetIsSecret(),
			}
		}
	}

	// Layer 2: runtime overrides (highest priority)
	for key, ev := range runtimeEnv {
		if ev == nil {
			continue
		}
		merged[key] = ev
	}

	return merged
}

// FilterByDeclaredKeys restricts a merged environment map to only the keys
// declared in the blueprint's env field. This enforces least-privilege:
// a blueprint only receives the environment variables it explicitly declared,
// even if the linked environments contain additional secrets.
//
// If declarations is nil or empty, the merged map is returned unchanged.
// This preserves behavior for blueprints that declare no env vars.
//
// Returns the filtered map and a sorted list of excluded keys for observability.
func FilterByDeclaredKeys(
	merged map[string]*executioncontextv1.ExecutionValue,
	declarations map[string]*environmentv1.EnvVarDeclaration,
) (filtered map[string]*executioncontextv1.ExecutionValue, excludedKeys []string) {
	if len(declarations) == 0 {
		return merged, nil
	}

	filtered = make(map[string]*executioncontextv1.ExecutionValue, len(declarations))
	for key, val := range merged {
		if _, declared := declarations[key]; declared {
			filtered[key] = val
		} else {
			excludedKeys = append(excludedKeys, key)
		}
	}

	sort.Strings(excludedKeys)
	return filtered, excludedKeys
}
